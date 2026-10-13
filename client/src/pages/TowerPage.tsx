import { canPlayFloor } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { t } from '../i18n/index.ts';
import { useCombat } from '../stores/combat.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

type FloorInfo = (typeof gameData.floors.floors)[number];

function FloorTooltip({ floor }: { floor: FloorInfo }) {
  const monsters = gameData.monsters.monsters.filter(
    (m) =>
      m.zoneFloor === floor.zoneFloor &&
      (floor.type !== 'normal' || (m.rank !== 'boss' && m.rank !== 'dragon')),
  );
  const element = gameData.elements.elements.find((e) => e.id === floor.element);
  return (
    <div className="tooltip-body">
      <strong>{t('tower.floor', { floor: floor.floor })}</strong>
      <span>
        {floor.zoneName} · {t(`tower.type.${floor.type}`)}
      </span>
      <span>{t('tower.monsterLevel', { level: floor.monsterLevel })}</span>
      <span>
        {t('tower.element')} : {element?.name}
      </span>
      <span>
        {t('tower.waves', { waves: floor.waves })} ·{' '}
        {monsters
          .filter((m) => m.rank !== 'boss' && m.rank !== 'dragon')
          .map((m) => m.name)
          .join(', ')}
      </span>
      {floor.bossName && (
        <span className="boss-name">{t('tower.boss', { name: floor.bossName })}</span>
      )}
      {floor.unlocksHuntingZone && (
        <span className="muted">{t('tower.unlocksZone', { zone: floor.unlocksHuntingZone })}</span>
      )}
    </div>
  );
}

/** La tour : 100 étages par biome, l'étage courant mis en avant, boss et dragons rejouables marqués. */
export function TowerPage() {
  const save = useSession((s) => s.save)!;
  const navigate = useNavigate();
  const start = useCombat((s) => s.start);
  const load = useCombat((s) => s.load);
  const inProgress = useCombat((s) => s.target);
  const busy = useCombat((s) => s.busy);
  const notify = useNotifications((s) => s.notify);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const play = async (floor: number) => {
    await start(floor);
    const { error } = useCombat.getState();
    if (error) notify('error', error);
    else navigate('/combat');
  };

  const biomes = [...gameData.elements.biomes].reverse();

  return (
    <div className="page">
      <TopBar />
      <main className="tower-page">
        <header className="tower-header">
          <h1>{t('tower.title')}</h1>
          <p className="muted">
            {t('tower.progress', { floor: save.currentFloor, cleared: save.highestFloorCleared })}
          </p>
          {inProgress && inProgress.phase === 'heroes' && (
            <button type="button" className="primary" onClick={() => navigate('/combat')}>
              {inProgress.mode === 'hunt'
                ? t('combat.resume')
                : t('tower.resume', { floor: inProgress.floor })}
            </button>
          )}
        </header>

        {biomes.map((biome) => {
          const floors = gameData.floors.floors
            .filter((f) => f.floor >= biome.floorMin && f.floor <= biome.floorMax)
            .reverse();
          return (
            <section key={biome.id} className={`biome biome-${biome.element}`}>
              <h2>
                {biome.name}
                <span className="muted">
                  {' '}
                  · {t('tower.floors', { min: biome.floorMin, max: biome.floorMax })}
                </span>
              </h2>
              <div className="floor-list">
                {floors.map((floor) => {
                  const playable = canPlayFloor(save, floor.floor) && !inProgress;
                  const cleared = floor.floor <= save.highestFloorCleared;
                  const current = floor.floor === save.currentFloor && !cleared;
                  const locked = floor.floor > save.currentFloor;
                  return (
                    <Tooltip key={floor.floor} content={<FloorTooltip floor={floor} />}>
                      <button
                        type="button"
                        ref={current ? currentRef : undefined}
                        className={[
                          'floor',
                          `floor-${floor.type}`,
                          current ? 'current' : '',
                          cleared ? 'cleared' : '',
                          locked ? 'locked' : '',
                        ].join(' ')}
                        // aria-disabled plutôt que disabled : l'infobulle reste visible au survol.
                        aria-disabled={!playable || busy}
                        onClick={() => {
                          if (playable && !busy) void play(floor.floor);
                        }}
                      >
                        <span className="floor-number">{floor.floor}</span>
                        <span className="floor-zone">{floor.zoneName}</span>
                        {floor.type !== 'normal' && (
                          <span className={`floor-badge ${floor.type}`}>
                            {t(`tower.type.${floor.type}`)}
                          </span>
                        )}
                        <span className="floor-state">
                          {current
                            ? t('tower.current')
                            : cleared && floor.type !== 'normal'
                              ? t('tower.replay')
                              : cleared
                                ? '✓'
                                : ''}
                        </span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
