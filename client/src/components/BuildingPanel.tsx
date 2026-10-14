import {
  canAfford,
  nextBuildingUpgrade,
  productionPerHour,
  tavernOffers,
  upgradeShortfall,
  warehouseCapacity,
  type NextUpgrade,
  type UpgradeShortfall,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { buildingById, resourceById, useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';
import { AlchemySection, UpgradeTowerSection } from './TowerSections.tsx';
import { WorkshopSection } from './items/WorkshopSection.tsx';
import { Modal } from './Modal.tsx';
import { PixelImage } from './PixelImage.tsx';
import { TavernSection } from './TavernSection.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Coût du niveau suivant : chaque ligne passe en rouge s'il manque quelque chose. */
function UpgradeCost({ next, shortfall }: { next: NextUpgrade; shortfall: UpgradeShortfall }) {
  const { cost } = next;
  const material = resourceById(cost.material);
  const coal = resourceById('charbon');
  return (
    <ul className="cost-list">
      <li className={shortfall.floor ? 'missing' : ''}>
        {t('building.requiredFloor', { floor: cost.requiredFloor })}
      </li>
      <li className={shortfall.gold > 0 ? 'missing' : ''}>
        <span className="gold-icon" aria-hidden="true" />
        {t('building.goldCost', { gold: formatNumber(cost.gold) })}
      </li>
      <li className={shortfall.material > 0 ? 'missing' : ''}>
        <PixelImage src={material?.image ?? null} alt="" size={16} />
        <span className="capitalize">
          {formatNumber(cost.quantity)} {material?.name ?? cost.material}
        </span>
      </li>
      {cost.coal > 0 && (
        <li className={shortfall.coal > 0 ? 'missing' : ''}>
          <PixelImage src={coal?.image ?? null} alt="" size={16} />
          <span className="capitalize">
            {formatNumber(cost.coal)} {coal?.name ?? 'charbon'}
          </span>
        </li>
      )}
    </ul>
  );
}

/** Panneau d'un bâtiment : niveau, production, effet et coût du niveau suivant, bouton « Améliorer ». */
export function BuildingPanel({
  buildingId,
  onClose,
}: {
  buildingId: string;
  onClose: () => void;
}) {
  const save = useSession((s) => s.save)!;
  const upgradeBuilding = useSession((s) => s.upgradeBuilding);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);

  const building = buildingById(buildingId)!;
  const level = save.buildings[buildingId] ?? null;
  const village = gameData.village;
  const productionRows = village.production.filter((p) => p.buildingId === buildingId);
  const next = level === null ? null : nextBuildingUpgrade(village, buildingId, level);
  const shortfall =
    next &&
    upgradeShortfall(next.cost, {
      gold: save.gold,
      resources: view.resources,
      floorCleared: save.bestFloorEver,
    });
  const affordable = shortfall !== null && canAfford(shortfall);

  const upgrade = async () => {
    setPending(true);
    try {
      await upgradeBuilding(buildingId);
      notify('success', t('building.upgraded', { name: building.name, level: (level ?? 0) + 1 }));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={building.name}
      className={`building-panel${buildingId === 'atelier_fabrication' ? ' workshop-panel' : ''}`}
    >
      <div className="building-head">
        <PixelImage src={building.image} alt={building.name} size={96} />
        <div>
          <p className="building-level">
            {level === null
              ? t('building.locked', { floor: building.unlockFloor })
              : building.maxLevel === null
                ? t('building.levelNoMax', { level })
                : t('building.level', { level, max: building.maxLevel })}
          </p>
          <p className="muted">{building.role}</p>
        </div>
      </div>

      {productionRows.length > 0 && (
        <section>
          <h3>{t('building.production')}</h3>
          <table className="production-table">
            <thead>
              <tr>
                <th>{t('building.resource')}</th>
                <th>{t('building.now')}</th>
                {next && <th>{t('building.nextLevel', { level: next.cost.targetLevel })}</th>}
              </tr>
            </thead>
            <tbody>
              {productionRows.map((row) => {
                const resource = resourceById(row.resourceId);
                // Production affichée bonus de la Tour d'amélioration compris.
                const withBonus = (rate: number | null) =>
                  rate === null ? null : Math.round(rate * (1 + view.productionBonus));
                const now =
                  level === null ? null : withBonus(productionPerHour(village, row, level));
                const later = next
                  ? withBonus(productionPerHour(village, row, next.cost.targetLevel))
                  : null;
                return (
                  <tr key={row.resourceId} className={now === null ? 'locked-row' : ''}>
                    <td>
                      <PixelImage src={resource?.image ?? null} alt="" size={16} />
                      <span className="capitalize">{resource?.name ?? row.resourceId}</span>
                    </td>
                    <td>
                      {now === null
                        ? t('building.unlockAt', { level: row.requiredBuildingLevel })
                        : t('resource.perHour', { rate: formatNumber(now) })}
                    </td>
                    {next && (
                      <td>
                        {later === null
                          ? '—'
                          : t('resource.perHour', { rate: formatNumber(later) })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {buildingId === 'entrepot' && level !== null && (
        <section>
          <h3>{t('building.capacity')}</h3>
          <p>
            {t('building.capacityValue', {
              capacity: formatNumber(warehouseCapacity(village, level)),
            })}
            {next && ` → ${formatNumber(warehouseCapacity(village, next.cost.targetLevel))}`}
          </p>
        </section>
      )}

      {buildingId === 'taverne' && level !== null && (
        <section>
          <h3>{t('building.offers')}</h3>
          <p>
            {t('building.offersValue', {
              items: tavernOffers(village, level).items,
              lots: tavernOffers(village, level).resourceLots,
              discount: Math.round(tavernOffers(village, level).discount * 100),
            })}
          </p>
          <TavernSection />
        </section>
      )}

      {buildingId === 'tour_alchimie' && level !== null && <AlchemySection level={level} />}
      {buildingId === 'tour_amelioration' && level !== null && <UpgradeTowerSection />}

      {buildingId === 'atelier_fabrication' && level !== null && <WorkshopSection level={level} />}

      {level !== null && (
        <section className="next-level">
          {next && shortfall ? (
            <>
              <h3>{t('building.nextLevel', { level: next.cost.targetLevel })}</h3>
              <p className="effect">{next.effect}</p>
              <UpgradeCost next={next} shortfall={shortfall} />
              <Tooltip
                content={
                  <div className="tooltip-body">
                    <strong>{t('building.upgradeTo', { level: next.cost.targetLevel })}</strong>
                    <UpgradeCost next={next} shortfall={shortfall} />
                    <span>{next.effect}</span>
                  </div>
                }
              >
                {/* Le span permet l'infobulle même quand le bouton est désactivé. */}
                <span className="upgrade-trigger" tabIndex={affordable ? -1 : 0}>
                  <button
                    type="button"
                    className="primary"
                    disabled={!affordable || pending}
                    onClick={upgrade}
                  >
                    {t('building.upgrade')}
                  </button>
                </span>
              </Tooltip>
              {shortfall.floor && (
                <p className="error">
                  {t('building.floorMissing', {
                    floor: next.cost.requiredFloor,
                    cleared: save.bestFloorEver,
                  })}
                </p>
              )}
            </>
          ) : (
            village.upgrades.some((u) => u.buildingId === buildingId) && (
              <p className="ok">{t('building.maxLevel')}</p>
            )
          )}
        </section>
      )}
    </Modal>
  );
}
