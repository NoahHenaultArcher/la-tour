import { ABYSS, byId, canPlayFloor } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { CombatantCard } from '../components/combat/CombatantCard.tsx';
import { MultiOutcomeModal } from '../components/combat/MultiOutcomeModal.tsx';
import { OutcomeModal } from '../components/combat/OutcomeModal.tsx';
import { SkillBar } from '../components/combat/SkillBar.tsx';
import { ElementBadge } from '../components/ElementBadge.tsx';
import { RelicIcon, RelicTooltip } from '../components/relics/RelicIcon.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { useDebug } from '../debug/console.ts';
import { backgroundSleep, usePageHidden } from '../game/background.ts';
import { combatantName } from '../game/combatText.ts';
import { elementStyle } from '../game/elements.ts';
import { t } from '../i18n/index.ts';
import { useCombat, type Speed } from '../stores/combat.ts';
import { useRoom } from '../stores/room.ts';
import { useSession } from '../stores/session.ts';

/** Durée d'affichage d'un événement à la vitesse ×1. */
const EVENT_DELAY_MS = 420;

/** Enchaînement : secondes avant de lancer l'étage suivant. */
const CHAIN_DELAY_S = 5;

const LOG_OPEN_KEY = 'la-tour.combatLogOpen';

/** Journal replié par défaut ; le choix du joueur est retenu (confort, stockage local facultatif). */
function useLogOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LOG_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((current) => {
      try {
        localStorage.setItem(LOG_OPEN_KEY, current ? '0' : '1');
      } catch {
        // Stockage indisponible : le choix vaut pour cette visite seulement.
      }
      return !current;
    });
  return [open, toggle] as const;
}

/**
 * Rejoue les événements reçus du serveur au rythme choisi, et enchaîne les tours en mode auto.
 * Onglet caché : le combat continue en arrière-plan (voir useBackgroundPlayback).
 */
function usePlayback() {
  const queueLength = useCombat((s) => s.queue.length);
  const view = useCombat((s) => s.view);
  const target = useCombat((s) => s.target);
  const pendingOutcome = useCombat((s) => s.pendingOutcome);
  const speed = useCombat((s) => s.speed);
  const step = useCombat((s) => s.step);
  const auto = useCombat((s) => s.auto);
  const busy = useCombat((s) => s.busy);
  const outcome = useCombat((s) => s.outcome);
  const playAuto = useCombat((s) => s.playAuto);
  const hidden = usePageHidden();
  useBackgroundPlayback(hidden);

  useEffect(() => {
    if (hidden || (queueLength === 0 && view === target && !pendingOutcome)) return;
    const timer = setTimeout(() => step(), queueLength > 0 ? EVENT_DELAY_MS / speed : 0);
    return () => clearTimeout(timer);
  }, [hidden, queueLength, view, target, pendingOutcome, speed, step]);

  const settled = queueLength === 0 && view === target && !pendingOutcome;
  useEffect(() => {
    if (!hidden && auto && settled && !busy && !outcome && view?.phase === 'heroes') {
      const timer = setTimeout(() => void playAuto(), 250 / speed);
      return () => clearTimeout(timer);
    }
  }, [hidden, auto, settled, busy, outcome, view, speed, playAuto]);

  return settled;
}

/**
 * Onglet caché : le navigateur ralentit les minuteries de la page (jusqu'à 1 par minute), ce qui
 * mettait le combat en pause. On applique alors les événements sans animation et on enchaîne les
 * tours auto avec une minuterie de Worker, au même rythme qu'à l'écran (cacher l'onglet ne fait pas
 * jouer plus vite). Au retour sur l'onglet, la relecture animée reprend.
 */
function useBackgroundPlayback(hidden: boolean) {
  useEffect(() => {
    if (!hidden) return;
    let active = true;
    void (async () => {
      while (active) {
        let played = 0;
        while (active && useCombat.getState().step()) played++;
        const { mode, auto, outcome, busy, view, speed, playAuto } = useCombat.getState();
        // Temps qu'aurait pris la relecture à l'écran (et le petit délai avant le tour auto suivant).
        await backgroundSleep(Math.max(250, (played * EVENT_DELAY_MS + 250) / speed));
        if (!active) break;
        if (mode !== 'multi' && auto && !outcome && !busy && view?.phase === 'heroes') {
          await playAuto();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [hidden]);
}

/**
 * Compte à rebours de l'enchaînement : relancé à chaque fin de combat, il appelle `onDone` à zéro.
 * Minuterie de Worker : l'enchaînement continue même onglet caché.
 */
function useChainCountdown(
  active: boolean,
  outcome: unknown,
  onDone: (() => void) | undefined,
): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!active) {
      setSeconds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      for (let left = CHAIN_DELAY_S; left > 0; left--) {
        setSeconds(left);
        await backgroundSleep(1000);
        if (cancelled) return;
      }
      setSeconds(null);
      done.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [active, outcome]);
  return seconds;
}

interface OutcomeAction {
  label: string;
  run: () => void;
}

/**
 * Suites possibles d'une fin de combat solo.
 * Enchaîner : étage suivant après une victoire, ou nouvelle chasse dans la même zone.
 * Abysse : l'étage suivant après une victoire, le même étage après une défaite.
 * Rejouer : un étage de boss ou de dragon (victoire comme défaite), s'il reste accessible.
 */
function useOutcomeActions(): { next: OutcomeAction | null; replay: OutcomeAction | null } {
  const outcome = useCombat((s) => s.outcome);
  const view = useCombat((s) => s.view);
  const combat = useCombat.getState();
  if (!outcome || !view) return { next: null, replay: null };
  const next: OutcomeAction | null =
    outcome.mode === 'hunt'
      ? { label: t('outcome.huntAgain'), run: () => void combat.startHunt(outcome.floor) }
      : outcome.mode === 'abyss'
        ? {
            label: t(
              outcome.result === 'victory' && outcome.floorCleared
                ? 'outcome.nextAbyss'
                : 'outcome.retryAbyss',
              { floor: outcome.save.abyssFloor },
            ),
            run: () => void combat.startAbyss(),
          }
        : outcome.result === 'victory' &&
            outcome.floorCleared &&
            outcome.save.currentFloor > view.floor
          ? {
              label: t('outcome.nextFloor'),
              run: () => void combat.start(outcome.save.currentFloor),
            }
          : null;
  const replay: OutcomeAction | null =
    outcome.mode === 'tower' &&
    view.floorType !== 'normal' &&
    canPlayFloor(outcome.save, outcome.floor)
      ? { label: t('outcome.replay'), run: () => void combat.start(outcome.floor) }
      : null;
  return { next, replay };
}

/** Secondes restantes avant la fin du tour (multijoueur) ; le serveur reste seul juge. */
function useCountdown(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
}

export function CombatPage() {
  const navigate = useNavigate();
  const view = useCombat((s) => s.view);
  const busy = useCombat((s) => s.busy);
  const error = useCombat((s) => s.error);
  const log = useCombat((s) => s.log);
  const floaters = useCombat((s) => s.floaters);
  const impacts = useCombat((s) => s.impacts);
  const actionSeq = useCombat((s) => s.actionSeq);
  const banner = useCombat((s) => s.banner);
  const activeId = useCombat((s) => s.activeId);
  const activeSkillId = useCombat((s) => s.activeSkillId);
  const outcome = useCombat((s) => s.outcome);
  const auto = useCombat((s) => s.auto);
  const chain = useCombat((s) => s.chain);
  const speed = useCombat((s) => s.speed);
  const selectedHeroId = useCombat((s) => s.selectedHeroId);
  const selectedSkillId = useCombat((s) => s.selectedSkillId);
  const isMulti = useCombat((s) => s.mode === 'multi');
  const ownHeroId = useCombat((s) => s.ownHeroId);
  const multiOutcome = useCombat((s) => s.multiOutcome);
  const seconds = useCountdown(useCombat((s) => s.turnDeadline));
  const isHost = useRoom((s) => s.room?.hostId === useSession.getState().user?.id);
  const combat = useCombat.getState();
  const setSave = useSession((s) => s.setSave);
  const isDebug = useDebug((s) => s.open);
  const settled = usePlayback();
  const logRef = useRef<HTMLOListElement>(null);
  const [logOpen, toggleLog] = useLogOpen();
  const { next, replay } = useOutcomeActions();
  // Enchaînement : seulement après une victoire avec un étage suivant (tour ou Abysse).
  const chainNext =
    outcome && outcome.mode !== 'hunt' && outcome.result === 'victory' ? next : null;
  const chainSeconds = useChainCountdown(chain && chainNext !== null, outcome, chainNext?.run);
  useEffect(() => {
    if (chain && outcome && !chainNext) combat.stopChain();
  }, [chain, outcome, chainNext, combat]);

  useEffect(() => {
    if (!useCombat.getState().view) void combat.load();
    // Chargement unique à l'arrivée sur la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, logOpen]);
  // La sauvegarde de fin de combat devient tout de suite la référence : les objets équipés
  // depuis la fenêtre de fin de combat partent de cet état.
  useEffect(() => {
    if (outcome) setSave(outcome.save);
  }, [outcome, setSave]);

  if (!view) {
    return (
      <div className="page">
        <TopBar />
        <main className="combat-page">
          <p className="muted">{busy ? t('app.loading') : t('combat.none')}</p>
          {!busy && (
            <button type="button" onClick={() => navigate('/tour')}>
              {t('outcome.toTower')}
            </button>
          )}
        </main>
      </div>
    );
  }

  const heroes = view.heroes;
  // Multijoueur : chacun ne commande que son héros (absent s'il l'a retiré d'une chasse).
  const ownHero = isMulti ? (heroes.find((h) => h.id === ownHeroId) ?? null) : null;
  const hero =
    (isMulti ? ownHero : null) ??
    heroes.find((h) => h.id === selectedHeroId && h.hp > 0 && !h.stunnedThisPhase) ??
    heroes.find((h) => h.hp > 0 && !h.stunnedThisPhase) ??
    heroes[0]!;
  const ownActions = isMulti && ownHero ? (view.heroActions?.[ownHero.id] ?? 0) : 0;
  const yourTurn =
    view.phase === 'heroes' &&
    settled &&
    !busy &&
    !auto &&
    (isMulti ? ownActions > 0 : view.actionsLeft > 0);
  const withdrawn = isMulti && !ownHero && !multiOutcome;
  // La sélection reste active pour enchaîner, tant que la compétence est prête.
  const selectedSlot = hero.skills.find((s) => s.skillId === selectedSkillId && s.remaining === 0);
  const selectedSkill = selectedSlot ? byId(gameData.skills.catalog, selectedSlot.skillId) : null;
  const abyss = view.mode === 'abyss';
  // L'Abysse prolonge le dernier étage de la tour (décor et élément du Palais démoniaque).
  const floor = gameData.floors.floors.find(
    (f) => f.floor === (abyss ? ABYSS.unlockFloor : view.floor),
  )!;
  const hunting = view.mode === 'hunt';
  const zone = hunting ? gameData.zones.zones.find((z) => z.floor === view.floor) : undefined;

  // Le décor prend la couleur de l'élément du biome (Forêt : Neutre, Volcan : Feu…).
  const element = zone?.element ?? floor.element;

  const leave = (to: '/village' | '/tour' | '/chasse' | '/abysse' | '/equipe') => {
    combat.clearOutcome();
    navigate(to);
  };

  const chooseSkill = (skillId: string) => {
    if (hero.id !== selectedHeroId) combat.selectHero(hero.id);
    combat.selectSkill(skillId);
    const skill = byId(gameData.skills.catalog, skillId);
    // Une attaque de zone ou une compétence sur soi ou sur l'équipe n'a pas besoin de cible.
    if (skill && skill.target !== 'single') void useCombat.getState().act();
  };

  return (
    // --speed accélère les animations avec la vitesse du combat (toujours ×1 en multijoueur).
    <div
      className="page combat-backdrop"
      style={{ ...elementStyle(element), '--speed': isMulti ? 1 : speed } as CSSProperties}
    >
      <TopBar />
      <main className="combat-page">
        <header className="combat-header">
          {abyss ? (
            <>
              <h1>{t('abyss.floor', { floor: view.floor })}</h1>
              <span>{t(`abyss.type.${view.floorType}`)}</span>
              <span>{t('combat.wave', { wave: view.waveIndex + 1, total: view.waveCount })}</span>
            </>
          ) : hunting ? (
            <>
              <h1>{zone?.name}</h1>
              <span>
                {t('hunt.levels', {
                  min: zone?.huntingLevelMin ?? 0,
                  max: zone?.huntingLevelMax ?? 0,
                })}
              </span>
              <span>{t('combat.waveHunt', { wave: view.waveIndex + 1 })}</span>
            </>
          ) : (
            <>
              <h1>{t('tower.floor', { floor: view.floor })}</h1>
              <span>
                {floor.zoneName} · {t(`tower.type.${view.floorType}`)}
              </span>
              <span>{t('combat.wave', { wave: view.waveIndex + 1, total: view.waveCount })}</span>
            </>
          )}
          <span className="round-chip" key={view.round}>
            {t('combat.round', { round: view.round })}
          </span>
          <ElementBadge element={element} />
          <button
            type="button"
            className="combat-log-toggle"
            aria-expanded={logOpen}
            aria-controls="combat-log"
            onClick={toggleLog}
          >
            {t(logOpen ? 'combat.log.hide' : 'combat.log.show')} {logOpen ? '▴' : '▾'}
          </button>
        </header>

        {(view.relics?.length ?? 0) > 0 && (
          <div className="combat-relics" aria-label={t('relic.combatTitle')}>
            <span className="muted small">{t('relic.combatTitle')}</span>
            {view.relics!.map((relicId, i) => (
              <Tooltip key={`${relicId}-${i}`} content={<RelicTooltip relicId={relicId} />}>
                <span tabIndex={0}>
                  <RelicIcon relicId={relicId} size={36} />
                </span>
              </Tooltip>
            ))}
          </div>
        )}
        <div className="initiative-bar" aria-label={t('combat.initiative')}>
          <span className={`initiative-side heroes${view.firstSide === 'hero' ? ' first' : ''}`}>
            {t('combat.side.heroes')} ·{' '}
            {t('combat.initiativeValue', { value: Math.round(view.heroInitiative) })}
          </span>
          <span className="initiative-arrow">{view.firstSide === 'hero' ? '▶' : '◀'}</span>
          <span
            className={`initiative-side monsters${view.firstSide === 'monster' ? ' first' : ''}`}
          >
            {t('combat.side.monsters')} ·{' '}
            {t('combat.initiativeValue', { value: Math.round(view.monsterInitiative) })}
          </span>
          <span className="turn-status">
            {view.phase !== 'heroes'
              ? ''
              : !settled || busy
                ? t('combat.resolving')
                : isMulti
                  ? ownActions > 0
                    ? t('combat.multiTurn', {
                        actions: ownActions,
                        total: view.actionsPerRound,
                        seconds: seconds ?? 0,
                      })
                    : t('combat.waitingOthers', { seconds: seconds ?? 0 })
                  : t('combat.yourTurn', {
                      actions: view.actionsLeft,
                      total: view.actionsPerRound,
                    })}
          </span>
        </div>

        <section className="combat-scene">
          {banner && (
            <div className="wave-banner" key={banner.id} aria-live="polite">
              {hunting
                ? t('combat.waveHunt', { wave: banner.wave })
                : t('combat.wave', { wave: banner.wave, total: banner.total })}
            </div>
          )}
          <div className="combat-side heroes">
            {heroes.map((h) => (
              <CombatantCard
                key={h.id}
                c={h}
                view={view}
                active={activeId === h.id}
                selected={heroes.length > 1 && hero.id === h.id}
                onClick={heroes.length > 1 && !isMulti ? () => combat.selectHero(h.id) : undefined}
                floaters={floaters.filter((f) => f.targetId === h.id)}
                impacts={impacts.filter((i) => i.targetId === h.id)}
                actionSeq={actionSeq}
              />
            ))}
          </div>
          <div className="combat-side monsters">
            {view.monsters.map((m) => (
              <CombatantCard
                key={m.id}
                c={m}
                view={view}
                active={activeId === m.id}
                targetable={yourTurn && selectedSkill?.target === 'single' && m.hp > 0}
                onClick={
                  yourTurn && selectedSkill?.target === 'single'
                    ? () => void combat.act(m.id)
                    : undefined
                }
                floaters={floaters.filter((f) => f.targetId === m.id)}
                impacts={impacts.filter((i) => i.targetId === m.id)}
                actionSeq={actionSeq}
              />
            ))}
          </div>
        </section>

        {withdrawn ? (
          <section className="combat-controls panel">
            <p>{t('combat.withdrawn')}</p>
            <div className="combat-buttons">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  combat.clearOutcome();
                  navigate('/salon');
                }}
              >
                {t('outcome.toRoom')}
              </button>
            </div>
          </section>
        ) : (
          <section className="combat-controls panel">
            <div className="combat-hero-title">
              <strong>{combatantName(view, hero.id)}</strong>
              {selectedSkill?.target === 'single' && yourTurn && (
                <span className="hint">
                  {t('combat.chooseTarget', { skill: selectedSkill.name })}
                </span>
              )}
              {!selectedSkill && yourTurn && (
                <span className="hint">{t('combat.chooseSkill')}</span>
              )}
            </div>
            <SkillBar
              hero={hero}
              selectedSkillId={selectedSkill?.id ?? null}
              disabled={!yourTurn || hero.hp <= 0 || hero.stunnedThisPhase}
              onSelect={chooseSkill}
              justUsedSkillId={activeId === hero.id ? activeSkillId : null}
            />
            {error && <p className="error">{error}</p>}
            <div className="combat-buttons">
              <button type="button" disabled={!yourTurn} onClick={() => void combat.pass()}>
                {t('combat.pass')}
              </button>
              {/* Mode auto et vitesse : solo uniquement. */}
              {!isMulti && (
                <>
                  <button
                    type="button"
                    className={auto ? 'toggled' : ''}
                    aria-pressed={auto}
                    disabled={view.phase !== 'heroes'}
                    onClick={() => combat.setAuto(!auto)}
                  >
                    {t(auto ? 'combat.autoOn' : 'combat.autoOff')}
                  </button>
                  <span className="speed-group" role="group" aria-label={t('combat.speed')}>
                    {([1, 2, 3] as Speed[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={speed === s ? 'toggled' : ''}
                        aria-pressed={speed === s}
                        onClick={() => combat.setSpeed(s)}
                      >
                        ×{s}
                      </button>
                    ))}
                  </span>
                </>
              )}
              {chain && (
                <button type="button" className="toggled" onClick={combat.stopChain}>
                  {t('combat.chainStop')}
                </button>
              )}
              {isDebug && (
                <button type="button" disabled={!yourTurn} onClick={() => void combat.winWave()}>
                  {t('debug.winWaveNow')}
                </button>
              )}
              {hunting ? (
                <button
                  type="button"
                  className="primary"
                  disabled={view.phase !== 'heroes' || busy}
                  onClick={() => void combat.retreat()}
                >
                  {t(isMulti ? 'combat.withdraw' : 'combat.retreat')}
                </button>
              ) : (
                (!isMulti || isHost) && (
                  <button
                    type="button"
                    className="danger"
                    disabled={view.phase !== 'heroes' || busy}
                    onClick={() => {
                      const question = isMulti
                        ? 'combat.hostForfeitConfirm'
                        : 'combat.forfeitConfirm';
                      if (window.confirm(t(question))) void combat.forfeit();
                    }}
                  >
                    {t(isMulti ? 'combat.hostForfeit' : 'combat.forfeit')}
                  </button>
                )
              )}
            </div>
          </section>
        )}

        {logOpen && (
          <section id="combat-log" className="combat-log panel" aria-label={t('combat.log.title')}>
            <ol ref={logRef}>
              {log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </section>
        )}
      </main>

      {multiOutcome && (
        <MultiOutcomeModal
          outcome={multiOutcome}
          onRoom={() => {
            combat.clearOutcome();
            navigate('/salon');
          }}
          onVillage={() => {
            combat.clearOutcome();
            navigate('/village');
          }}
        />
      )}
      {outcome && (
        <OutcomeModal
          outcome={outcome}
          onVillage={() => leave('/village')}
          onTower={() =>
            leave(
              outcome.mode === 'hunt' ? '/chasse' : outcome.mode === 'abyss' ? '/abysse' : '/tour',
            )
          }
          onTeam={() => leave('/equipe')}
          next={next}
          replay={replay}
          onChain={
            chainNext && !chain
              ? () => {
                  combat.startChain();
                  chainNext.run();
                }
              : null
          }
          chainSeconds={chain ? chainSeconds : null}
          onStopChain={combat.stopChain}
        />
      )}
    </div>
  );
}
