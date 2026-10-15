import {
  ABYSS,
  ALPHA,
  ALPHA_TRAIT_IDS,
  LEADERBOARD_SCORE,
  abyssDifficulty,
  abyssDragon,
  abyssFloorType,
  abyssHighRarityBoost,
  abyssMonsterLevel,
  heritageMultiplier,
  isAbyssUnlocked,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { MonsterTooltip, alphaTraitText } from '../components/combat/CombatantCard.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { formatNumber, t } from '../i18n/index.ts';
import { useCombat } from '../stores/combat.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

/** Étages affichés à l'avance (l'étage courant compris). */
const UPCOMING = 10;

const percent = (value: number) => `${Math.round(value * 100)} %`;
const times = (value: number) => `×${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

/** Infobulle d'un étage de l'Abysse : type, niveau, renfort, butin, dragon de la tanière. */
function AbyssFloorTooltip({ floor }: { floor: number }) {
  const type = abyssFloorType(floor);
  const difficulty = abyssDifficulty(floor);
  const dragon = abyssDragon(gameData.monsters, floor);
  return (
    <div className="tooltip-body">
      <strong>{t('abyss.floor', { floor })}</strong>
      <span>{t(`abyss.type.${type}`)}</span>
      <span>{t('tower.monsterLevel', { level: abyssMonsterLevel(floor) })}</span>
      <span>
        {t('abyss.reinforcement', {
          hp: times(difficulty.hp),
          attack: times(difficulty.attack),
        })}
      </span>
      {type === 'boss' && <span className="muted">{t('abyss.bossInfo')}</span>}
      {dragon && <span className="boss-name">{t('abyss.lairOf', { name: dragon.name })}</span>}
      <span className="muted">
        {t('abyss.lootBoost', { boost: times(abyssHighRarityBoost(floor)) })}
      </span>
    </div>
  );
}

/** L'Abysse : étages sans fin après la tour, de plus en plus durs. */
export function AbyssPage() {
  const save = useSession((s) => s.save)!;
  const navigate = useNavigate();
  const startAbyss = useCombat((s) => s.startAbyss);
  const load = useCombat((s) => s.load);
  const inProgress = useCombat((s) => s.target);
  const busy = useCombat((s) => s.busy);
  const notify = useNotifications((s) => s.notify);

  useEffect(() => {
    void load();
  }, [load]);

  const unlocked = isAbyssUnlocked(save.highestFloorCleared);
  const fighting = inProgress?.phase === 'heroes';
  const current = save.abyssFloor;
  const floors = Array.from({ length: UPCOMING }, (_, i) => current + i);
  const dragon = abyssDragon(gameData.monsters, current);

  const descend = async () => {
    if (busy || fighting) return;
    await startAbyss();
    const { error } = useCombat.getState();
    if (error) notify('error', error);
    else navigate('/combat');
  };

  return (
    <div className="page">
      <TopBar />
      <main className="abyss-page">
        <header className="tower-header">
          <h1>{t('abyss.title')}</h1>
          <p className="muted">{t('abyss.intro')}</p>
        </header>

        {!unlocked ? (
          <section className="panel abyss-locked">
            <p>{t('abyss.locked', { cleared: save.highestFloorCleared })}</p>
            {save.bestAbyssFloor > 0 && (
              <p className="muted">{t('abyss.lockedRecord', { record: save.bestAbyssFloor })}</p>
            )}
            <Link to="/tour" className="button primary">
              {t('home.seeTower')}
            </Link>
          </section>
        ) : (
          <>
            <section className="panel abyss-current">
              <div className="abyss-stats">
                <div>
                  <span className="muted small">{t('abyss.currentFloor')}</span>
                  <strong className="abyss-big">{current}</strong>
                </div>
                <div>
                  <span className="muted small">{t('abyss.record')}</span>
                  <strong className="abyss-big">{save.bestAbyssFloor}</strong>
                </div>
                <div>
                  <span className="muted small">{t('abyss.heritage')}</span>
                  <strong className="abyss-big">
                    +{percent(heritageMultiplier(save.heritageCount) - 1)}
                  </strong>
                </div>
              </div>
              <Tooltip content={<AbyssFloorTooltip floor={current} />}>
                <p className="abyss-next" tabIndex={0}>
                  {t('abyss.nextLine', {
                    floor: current,
                    type: t(`abyss.type.${abyssFloorType(current)}`),
                    level: abyssMonsterLevel(current),
                  })}
                </p>
              </Tooltip>
              {dragon && (
                <Tooltip
                  content={
                    <MonsterTooltip
                      monsterId={dragon.id}
                      element={
                        gameData.zones.zones.find((z) => z.floor === dragon.zoneFloor)?.element ??
                        'neutral'
                      }
                      levelText={t('combat.level', { level: abyssMonsterLevel(current) })}
                    />
                  }
                >
                  <span className="abyss-dragon" tabIndex={0}>
                    <PixelImage src={dragon.image} alt={dragon.name} size={72} />
                  </span>
                </Tooltip>
              )}
              <div className="home-actions">
                {fighting ? (
                  <button type="button" className="primary" onClick={() => navigate('/combat')}>
                    {t('combat.resume')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    aria-disabled={busy}
                    onClick={() => void descend()}
                  >
                    {t('abyss.descend', { floor: current })}
                  </button>
                )}
              </div>
            </section>

            <section className="panel">
              <h2>{t('abyss.upcoming')}</h2>
              <ol className="abyss-floors">
                {floors.map((floor) => {
                  const type = abyssFloorType(floor);
                  const lair = abyssDragon(gameData.monsters, floor);
                  return (
                    <Tooltip key={floor} content={<AbyssFloorTooltip floor={floor} />}>
                      <li
                        tabIndex={0}
                        className={`abyss-floor ${type}${floor === current ? ' current' : ''}`}
                      >
                        <span className="floor-number">{floor}</span>
                        <span>
                          {t(`abyss.type.${type}`)}
                          {lair && <span className="muted"> · {lair.name}</span>}
                        </span>
                        <span className="muted small">
                          {t('combat.levelShort', { level: abyssMonsterLevel(floor) })}
                        </span>
                      </li>
                    </Tooltip>
                  );
                })}
              </ol>
            </section>
          </>
        )}

        <section className="panel abyss-alphas">
          <h2>{t('alpha.sectionTitle')}</h2>
          <p className="muted">
            {t('alpha.intro', {
              chance: percent(ALPHA.chance),
              hp: ALPHA.hpMultiplier,
              attack: String(ALPHA.attackMultiplier).replace('.', ','),
              rewards: ALPHA.rewardMultiplier,
            })}
          </p>
          <ul className="alpha-traits">
            {ALPHA_TRAIT_IDS.map((trait) => (
              <li key={trait}>
                <strong>{t(`alpha.trait.${trait}.name`)}</strong>
                <span>{alphaTraitText(trait)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>{t('abyss.rulesTitle')}</h2>
          <ul className="abyss-rules">
            <li>{t('abyss.rule.mixed')}</li>
            <li>{t('abyss.rule.boss')}</li>
            <li>{t('abyss.rule.lair', { chance: percent(ABYSS.dragonChance) })}</li>
            <li>
              {t('abyss.rule.fusion', {
                share: percent(ABYSS.fusionChance),
                chance: percent(ABYSS.fusionTrigger),
              })}
            </li>
            <li>{t('abyss.rule.loot')}</li>
            <li>{t('abyss.rule.heritage')}</li>
            <li>
              {t('abyss.rule.score', { points: formatNumber(LEADERBOARD_SCORE.perAbyssFloor) })}
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
