import {
  canAfford,
  maxFusions,
  nextBuildingUpgrade,
  productionPerHour,
  tavernOffers,
  upgradeShortfall,
  warehouseCapacity,
  workshopMaxTier,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { BuildingPanel } from '../components/BuildingPanel.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { ResourceBar } from '../components/ResourceBar.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { heroImage, heroName, saveTier } from '../game/evolution.ts';
import { resourceById, useVillageView, type VillageView } from '../game/village.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';

type Building = (typeof gameData.village.buildings)[number];

/** La tour a sa propre page (menu du haut) : elle n'apparaît plus parmi les bâtiments. */
const HIDDEN_BUILDINGS = new Set(['tour']);

/** Lignes de production d'un bâtiment, avec le débit actuel (null : ressource pas encore ouverte). */
function productionOf(buildingId: string, level: number | null, view: VillageView) {
  const village = gameData.village;
  return village.production
    .filter((p) => p.buildingId === buildingId)
    .map((row) => {
      const rate = level === null ? null : productionPerHour(village, row, level);
      return {
        row,
        resource: resourceById(row.resourceId),
        rate: rate === null ? null : Math.round(rate * (1 + view.productionBonus)),
      };
    });
}

/** Colonne du milieu : niveau, production par heure ou chiffre clé du bâtiment. */
function BuildingStatus({
  building,
  level,
  view,
}: {
  building: Building;
  level: number | null;
  view: VillageView;
}) {
  const save = useSession((s) => s.save)!;
  if (level === null) {
    return (
      <div className="building-status">
        <strong>{building.name}</strong>
        <span className="error">{t('building.locked', { floor: building.unlockFloor })}</span>
      </div>
    );
  }
  const village = gameData.village;
  const producing = productionOf(building.id, level, view).filter((p) => p.rate !== null);
  const next = nextBuildingUpgrade(village, building.id, level);
  const upgradable =
    next !== null &&
    canAfford(
      upgradeShortfall(next.cost, {
        gold: save.gold,
        resources: view.resources,
        floorCleared: save.bestFloorEver,
      }),
    );
  const offers = building.id === 'taverne' ? tavernOffers(village, level) : null;

  return (
    <div className="building-status">
      <strong>{building.name}</strong>
      <span className="building-level">
        {building.maxLevel === null
          ? t('building.levelNoMax', { level })
          : t('building.level', { level, max: building.maxLevel })}
        {upgradable && <span className="ok"> · {t('village.upgradable')}</span>}
      </span>
      {producing.length > 0 && (
        <ul className="building-rates">
          {producing.map(({ row, resource, rate }) => (
            <li key={row.resourceId}>
              <PixelImage src={resource?.image ?? null} alt="" size={16} />
              <span className="capitalize">{resource?.name ?? row.resourceId}</span>
              <span className="muted">
                {t('resource.perHour', { rate: formatNumber(rate ?? 0) })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {building.id === 'entrepot' && (
        <span>
          {t('building.capacityValue', {
            capacity: formatNumber(warehouseCapacity(village, level)),
          })}
        </span>
      )}
      {offers && (
        <span>
          {t('building.offersValue', {
            items: offers.items,
            lots: offers.resourceLots,
            discount: Math.round(offers.discount * 100),
          })}
        </span>
      )}
      {building.id === 'atelier_fabrication' && (
        <span>{t('workshop.tiers', { tier: workshopMaxTier(level) })}</span>
      )}
      {building.id === 'tour_alchimie' && (
        <span>{t('alchemy.perHero', { count: maxFusions(level) })}</span>
      )}
    </div>
  );
}

/** Colonne de droite : ce que fait le bâtiment et ce qu'on y trouve. */
function BuildingInfo({ building, level }: { building: Building; level: number | null }) {
  const village = gameData.village;
  const resources = village.production.filter((p) => p.buildingId === building.id);
  return (
    <div className="building-info">
      <span className="building-type muted small">{building.type}</span>
      <p>{building.role}</p>
      {building.id === 'taverne' && (
        <ul className="building-contents">
          <li>{t('village.tavern.items')}</li>
          <li>{t('village.tavern.resources')}</li>
          <li>{t('village.tavern.characters')}</li>
        </ul>
      )}
      {building.id === 'atelier_fabrication' && (
        <ul className="building-contents">
          <li>{t('village.workshop.craft')}</li>
          <li>{t('village.workshop.upgrade')}</li>
        </ul>
      )}
      {resources.length > 0 && (
        <ul className="building-resources">
          {resources.map((row) => {
            const resource = resourceById(row.resourceId);
            const open = level !== null && level >= row.requiredBuildingLevel;
            return (
              <li
                key={row.resourceId}
                className={open ? '' : 'locked'}
                title={
                  open ? undefined : t('building.unlockAt', { level: row.requiredBuildingLevel })
                }
              >
                <PixelImage src={resource?.image ?? null} alt="" size={20} />
                <span className="capitalize">{resource?.name ?? row.resourceId}</span>
                {!open && (
                  <span className="small">
                    {t('village.levelBadge', { level: row.requiredBuildingLevel })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Page centrale : les ressources, les bâtiments du village (une ligne chacun) et l'équipe. */
export function VillagePage() {
  const save = useSession((s) => s.save)!;
  const view = useVillageView();
  const [openBuilding, setOpenBuilding] = useState<string | null>(null);
  const buildings = gameData.village.buildings.filter((b) => !HIDDEN_BUILDINGS.has(b.id));

  return (
    <div className="page">
      <TopBar />
      {/* Deuxième barre, propre au village : toutes les ressources et la capacité de l'Entrepôt. */}
      <div className="village-resources" aria-label={t('village.resources')}>
        <ResourceBar withGold={false} />
        <span className="muted small village-capacity">
          {t('village.capacity', { capacity: formatNumber(view.capacity) })}
        </span>
      </div>
      <main className="village-page">
        <section className="village-scene" aria-label={t('village.title')}>
          <h1>{t('village.title')}</h1>
          <ul className="building-list">
            {buildings.map((building) => {
              const level = save.buildings[building.id] ?? null;
              return (
                <li key={building.id}>
                  {/* Ligne cliquable (div : une liste ne peut pas être dans un <button>). */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`building-row${level === null ? ' locked' : ''}`}
                    title={t('village.clickToOpen')}
                    onClick={() => setOpenBuilding(building.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenBuilding(building.id);
                      }
                    }}
                  >
                    <span className="building-art">
                      <PixelImage src={building.image} alt="" size={96} />
                    </span>
                    <BuildingStatus building={building} level={level} view={view} />
                    <BuildingInfo building={building} level={level} />
                  </div>
                </li>
              );
            })}
          </ul>
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
                  src={heroImage(character.classId, saveTier(save))}
                  alt={heroName(character.classId, saveTier(save))}
                  size={48}
                />
                <div>
                  <strong>{heroName(character.classId, saveTier(save))}</strong>
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
