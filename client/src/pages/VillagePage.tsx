import { buildingProduction } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { BuildingPanel } from '../components/BuildingPanel.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { resourceById } from '../game/village.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';

/** Infobulle d'un bâtiment dans le village : niveau et production, ou condition de déblocage. */
function BuildingTooltip({ buildingId, level }: { buildingId: string; level: number | null }) {
  const building = gameData.village.buildings.find((b) => b.id === buildingId)!;
  const production = level === null ? {} : buildingProduction(gameData.village, buildingId, level);
  return (
    <div className="tooltip-body">
      <strong>{building.name}</strong>
      {level === null ? (
        <span className="error">{t('building.locked', { floor: building.unlockFloor })}</span>
      ) : (
        <span>
          {building.maxLevel === null
            ? t('building.levelNoMax', { level })
            : t('building.level', { level, max: building.maxLevel })}
        </span>
      )}
      {Object.entries(production).map(([id, rate]) => (
        <span key={id} className="capitalize">
          {resourceById(id)?.name} : {t('resource.perHour', { rate: formatNumber(rate) })}
        </span>
      ))}
      <span className="muted">{t('village.clickToOpen')}</span>
    </div>
  );
}

/** Page centrale : les bâtiments du village (cliquables) et l'équipe. */
export function VillagePage() {
  const save = useSession((s) => s.save)!;
  const [openBuilding, setOpenBuilding] = useState<string | null>(null);

  return (
    <div className="page">
      <TopBar />
      <main className="village-page">
        <section className="village-scene" aria-label={t('village.title')}>
          <h1>{t('village.title')}</h1>
          <div className="village-grid">
            {gameData.village.buildings.map((building) => {
              const level = save.buildings[building.id] ?? null;
              return (
                <Tooltip
                  key={building.id}
                  content={<BuildingTooltip buildingId={building.id} level={level} />}
                >
                  <button
                    type="button"
                    className={`building-tile${level === null ? ' locked' : ''}`}
                    onClick={() => setOpenBuilding(building.id)}
                  >
                    <PixelImage src={building.image} alt="" size={96} />
                    <span className="building-name">{building.name}</span>
                    <span className="building-badge">
                      {level === null
                        ? t('village.lockedBadge', { floor: building.unlockFloor })
                        : building.maxLevel === null
                          ? '—'
                          : t('village.levelBadge', { level })}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </section>

        <aside className="panel team-panel">
          <h2>{t('home.team')}</h2>
          <p className="muted">
            {t('village.towerProgress', {
              floor: save.currentFloor,
              cleared: save.highestFloorCleared,
            })}
          </p>
          <ul className="team">
            {save.characters.map((character) => (
              <li key={character.id}>
                <PixelImage
                  src={CLASS_IMAGES[character.classId]}
                  alt={t(`class.name.${character.classId}`)}
                  size={48}
                />
                <div>
                  <strong>{t(`class.name.${character.classId}`)}</strong>
                  <div>{t('home.level', { level: character.level })}</div>
                  <div className="muted">
                    {character.xpToNextLevel === null
                      ? t('home.xpMax')
                      : t('home.xp', {
                          xp: formatNumber(character.xp),
                          next: formatNumber(character.xpToNextLevel),
                        })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      {openBuilding && (
        <BuildingPanel buildingId={openBuilding} onClose={() => setOpenBuilding(null)} />
      )}
    </div>
  );
}
