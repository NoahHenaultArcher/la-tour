import { gameData } from '@la-tour/shared/data';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { CombatantCard } from '../components/combat/CombatantCard.tsx';
import { OutcomeModal } from '../components/combat/OutcomeModal.tsx';
import { SkillBar } from '../components/combat/SkillBar.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { useDebug } from '../debug/console.ts';
import { combatantName } from '../game/combatText.ts';
import { t } from '../i18n/index.ts';
import { useCombat, type Speed } from '../stores/combat.ts';
import { useSession } from '../stores/session.ts';

/** Durée d'affichage d'un événement à la vitesse ×1. */
const EVENT_DELAY_MS = 420;

/** Rejoue les événements reçus du serveur au rythme choisi, et enchaîne les tours en mode auto. */
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

  useEffect(() => {
    if (queueLength === 0 && view === target && !pendingOutcome) return;
    const timer = setTimeout(() => step(), queueLength > 0 ? EVENT_DELAY_MS / speed : 0);
    return () => clearTimeout(timer);
  }, [queueLength, view, target, pendingOutcome, speed, step]);

  const settled = queueLength === 0 && view === target && !pendingOutcome;
  useEffect(() => {
    if (auto && settled && !busy && !outcome && view?.phase === 'heroes') {
      const timer = setTimeout(() => void playAuto(), 250 / speed);
      return () => clearTimeout(timer);
    }
  }, [auto, settled, busy, outcome, view, speed, playAuto]);

  return settled;
}

export function CombatPage() {
  const navigate = useNavigate();
  const view = useCombat((s) => s.view);
  const busy = useCombat((s) => s.busy);
  const error = useCombat((s) => s.error);
  const log = useCombat((s) => s.log);
  const floaters = useCombat((s) => s.floaters);
  const activeId = useCombat((s) => s.activeId);
  const outcome = useCombat((s) => s.outcome);
  const auto = useCombat((s) => s.auto);
  const speed = useCombat((s) => s.speed);
  const selectedHeroId = useCombat((s) => s.selectedHeroId);
  const selectedSkillId = useCombat((s) => s.selectedSkillId);
  const combat = useCombat.getState();
  const setSave = useSession((s) => s.setSave);
  const isDebug = useDebug((s) => s.open);
  const settled = usePlayback();
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!useCombat.getState().view) void combat.load();
    // Chargement unique à l'arrivée sur la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

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
  const hero =
    heroes.find((h) => h.id === selectedHeroId && h.hp > 0 && !h.stunnedThisPhase) ??
    heroes.find((h) => h.hp > 0 && !h.stunnedThisPhase) ??
    heroes[0]!;
  const yourTurn = view.phase === 'heroes' && settled && !busy && !auto && view.actionsLeft > 0;
  // La sélection reste active pour enchaîner, tant que la compétence est prête.
  const selectedSlot = hero.skills.find((s) => s.skillId === selectedSkillId && s.remaining === 0);
  const selectedSkill = selectedSlot
    ? gameData.skills.catalog.find((s) => s.id === selectedSlot.skillId)
    : null;
  const floor = gameData.floors.floors.find((f) => f.floor === view.floor)!;
  const hunting = view.mode === 'hunt';
  const zone = hunting ? gameData.zones.zones.find((z) => z.floor === view.floor) : undefined;

  const leave = (to: '/village' | '/tour' | '/chasse') => {
    if (outcome) setSave(outcome.save);
    combat.clearOutcome();
    navigate(to);
  };
  // Enchaîner : étage suivant après une victoire, ou nouvelle chasse dans la même zone.
  const next: { label: string; run: () => void } | null =
    outcome?.mode === 'hunt'
      ? {
          label: t('outcome.huntAgain'),
          run: () => {
            setSave(outcome.save);
            void combat.startHunt(outcome.floor);
          },
        }
      : outcome?.result === 'victory' &&
          outcome.floorCleared &&
          outcome.save.currentFloor > view.floor
        ? {
            label: t('outcome.nextFloor'),
            run: () => {
              setSave(outcome.save);
              void combat.start(outcome.save.currentFloor);
            },
          }
        : null;

  const chooseSkill = (skillId: string) => {
    if (hero.id !== selectedHeroId) combat.selectHero(hero.id);
    combat.selectSkill(skillId);
    const skill = gameData.skills.catalog.find((s) => s.id === skillId);
    // Une attaque de zone n'a pas besoin de cible.
    if (skill?.target === 'area') void useCombat.getState().act();
  };

  return (
    <div className="page">
      <TopBar />
      <main className="combat-page">
        <header className="combat-header">
          {hunting ? (
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
          <span>{t('combat.round', { round: view.round })}</span>
        </header>

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
              : settled && !busy
                ? t('combat.yourTurn', { actions: view.actionsLeft, total: view.actionsPerRound })
                : t('combat.resolving')}
          </span>
        </div>

        <section className="combat-scene">
          <div className="combat-side heroes">
            {heroes.map((h) => (
              <CombatantCard
                key={h.id}
                c={h}
                view={view}
                active={activeId === h.id}
                selected={heroes.length > 1 && hero.id === h.id}
                onClick={heroes.length > 1 ? () => combat.selectHero(h.id) : undefined}
                floaters={floaters.filter((f) => f.targetId === h.id)}
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
              />
            ))}
          </div>
        </section>

        <section className="combat-controls panel">
          <div className="combat-hero-title">
            <strong>{combatantName(view, hero.id)}</strong>
            {selectedSkill?.target === 'single' && yourTurn && (
              <span className="hint">
                {t('combat.chooseTarget', { skill: selectedSkill.name })}
              </span>
            )}
            {!selectedSkill && yourTurn && <span className="hint">{t('combat.chooseSkill')}</span>}
          </div>
          <SkillBar
            hero={hero}
            selectedSkillId={selectedSkill?.id ?? null}
            disabled={!yourTurn || hero.hp <= 0 || hero.stunnedThisPhase}
            onSelect={chooseSkill}
          />
          {error && <p className="error">{error}</p>}
          <div className="combat-buttons">
            <button type="button" disabled={!yourTurn} onClick={() => void combat.pass()}>
              {t('combat.pass')}
            </button>
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
                onClick={() => {
                  combat.setAuto(false);
                  void combat.retreat();
                }}
              >
                {t('combat.retreat')}
              </button>
            ) : (
              <button
                type="button"
                className="danger"
                disabled={view.phase !== 'heroes' || busy}
                onClick={() => {
                  if (window.confirm(t('combat.forfeitConfirm'))) void combat.forfeit();
                }}
              >
                {t('combat.forfeit')}
              </button>
            )}
          </div>
        </section>

        <section className="combat-log panel">
          <h2>{t('combat.log.title')}</h2>
          <ol ref={logRef}>
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      </main>

      {outcome && (
        <OutcomeModal
          outcome={outcome}
          onVillage={() => leave('/village')}
          onTower={() => leave(outcome.mode === 'hunt' ? '/chasse' : '/tour')}
          next={next}
        />
      )}
    </div>
  );
}
