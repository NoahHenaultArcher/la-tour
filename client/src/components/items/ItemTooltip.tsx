import {
  STAT_IDS,
  itemWorkTier,
  workshopMaxTier,
  workshopUpgradeCost,
  type ItemDto,
  type SaveDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import {
  catalogItem,
  compareStats,
  equippedIn,
  formatStat,
  rarityInfo,
  statInfo,
  statsOf,
} from '../../game/items.ts';
import { resourceById } from '../../game/village.ts';
import { formatNumber, t } from '../../i18n/index.ts';

interface Props {
  item: ItemDto;
  save: SaveDto;
  /** Stocks estimés (barre de ressources), pour colorer le coût en rouge. */
  resources: Record<string, number>;
  /** Personnage pour la comparaison (par défaut : celui qui porte l'objet). */
  compareWith?: string | null;
}

/** Nom affiché d'un objet, coloré par sa rareté. */
export function ItemName({
  catalogId,
  upgradeLevel = 0,
}: {
  catalogId: string;
  upgradeLevel?: number;
}) {
  const info = catalogItem(catalogId);
  return (
    <span className="item-name" style={{ color: rarityInfo(info.rarity).color }}>
      {info.name}
      {upgradeLevel > 0 ? ` +${upgradeLevel}` : ''}
    </span>
  );
}

/**
 * Infobulle d'un objet : nom coloré, rareté, stats, passif d'Unique, niveau d'amélioration,
 * coût du niveau suivant (en rouge s'il manque) et comparaison avec l'objet équipé.
 */
export function ItemTooltip({ item, save, resources, compareWith }: Props) {
  const info = catalogItem(item.catalogId);
  const rarity = rarityInfo(info.rarity);
  const stats = statsOf(item);
  const unique = gameData.equipment.uniques.find((u) => u.id === info.id);

  const workshopLevel = save.buildings.atelier_fabrication;
  const cost = workshopUpgradeCost(gameData.equipment, info, item.upgradeLevel, workshopLevel ?? 0);
  const tier = itemWorkTier(gameData.equipment, info, item.upgradeLevel);
  const tierLocked = tier > workshopMaxTier(workshopLevel);
  const missing = cost ? (resources[cost.resourceId] ?? 0) < cost.quantity : false;

  const owner = compareWith ?? item.equippedBy;
  const reference = owner && item.equippedBy !== owner ? equippedIn(save, owner, info.slot) : null;
  const deltas =
    owner && item.equippedBy !== owner
      ? compareStats(stats, reference ? statsOf(reference) : null)
      : [];

  return (
    <div className="tooltip-body item-tooltip">
      <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
      <span className="muted">
        {rarity.name} · {t(`class.name.${info.classId}`)} · {t(`slot.${info.slot}`)}
      </span>
      <span>{t('item.upgrade', { level: item.upgradeLevel, max: info.maxUpgrade })}</span>
      <ul className="stat-lines">
        {STAT_IDS.filter((id) => stats[id] !== 0).map((id) => (
          <li key={id}>
            {statInfo(id).name} : <strong>{formatStat(id, stats[id], true)}</strong>
          </li>
        ))}
      </ul>
      {unique && (
        <span className="unique-passive">
          <strong>{unique.passiveName}</strong> : {unique.passiveEffect} ({unique.passiveLimit})
        </span>
      )}
      {cost ? (
        <span className={missing ? 'missing' : ''}>
          {t('item.nextCost', {
            quantity: formatNumber(cost.quantity),
            resource: resourceById(cost.resourceId)?.name ?? cost.resourceId,
            have: formatNumber(resources[cost.resourceId] ?? 0),
          })}
          {workshopLevel === undefined
            ? ` · ${t('item.workshopLocked')}`
            : tierLocked
              ? ` · ${t('item.tierLocked', { tier })}`
              : ''}
        </span>
      ) : (
        <span className="ok">{t('item.maxed')}</span>
      )}
      {owner && item.equippedBy !== owner && (
        <div className="comparison">
          <span className="muted">
            {reference
              ? t('item.compareWith', { name: catalogItem(reference.catalogId).name })
              : t('item.compareEmpty')}
          </span>
          {deltas.map(({ id, delta }) => (
            <span key={id} className={delta > 0 ? 'better' : 'worse'}>
              {statInfo(id).name} {formatStat(id, delta, true)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
