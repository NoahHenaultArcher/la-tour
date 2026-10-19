import {
  CLASS_IDS,
  RARITY_IDS,
  SLOT_IDS,
  craftCost,
  craftRarityChances,
  itemWorkTier,
  workshopMaxTier,
  workshopUpgradeCost,
  type ClassId,
  type ItemDto,
  type SlotId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { catalogItem, equippedIn, rarityInfo } from '../../game/items.ts';
import { resourceById, useVillageView } from '../../game/village.ts';
import { errorMessage, formatNumber, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';
import { PixelImage } from '../PixelImage.tsx';
import { Tooltip } from '../Tooltip.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { ItemName, ItemTooltip } from './ItemTooltip.tsx';
import { StatDeltas } from './StatDeltas.tsx';

/** Inventaire : par emplacement, puis du plus fort au plus faible. */
function compareItems(a: ItemDto, b: ItemDto): number {
  const ia = catalogItem(a.catalogId);
  const ib = catalogItem(b.catalogId);
  return (
    SLOT_IDS.indexOf(ia.slot) - SLOT_IDS.indexOf(ib.slot) ||
    (ib.tier ?? 0) - (ia.tier ?? 0) ||
    RARITY_IDS.indexOf(ib.rarity) - RARITY_IDS.indexOf(ia.rarity) ||
    b.upgradeLevel - a.upgradeLevel
  );
}

/** Chance en pourcentage : 70 %, 2,5 %, 0,05 %. */
const formatChance = (value: number) =>
  `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

/** Coût d'une ressource, en rouge s'il en manque, avec le stock actuel. */
function ResourceCost({
  resourceId,
  quantity,
  have,
}: {
  resourceId: string;
  quantity: number;
  have: number;
}) {
  const resource = resourceById(resourceId);
  return (
    <p className={`workshop-cost${have < quantity ? ' missing' : ''}`}>
      <PixelImage src={resource?.image ?? null} alt="" size={20} />
      <span className="capitalize">
        {formatNumber(quantity)} {resource?.name ?? resourceId}
      </span>
      <span className="muted small">({t('workshop.have', { amount: formatNumber(have) })})</span>
    </p>
  );
}

/**
 * Contenu du panneau de l'Atelier, en trois colonnes pour la classe choisie :
 * fabrication à gauche, objets de la classe au milieu, amélioration de l'objet choisi à droite.
 */
export function WorkshopSection({ level }: { level: number }) {
  const save = useSession((s) => s.save)!;
  const upgradeItem = useSession((s) => s.upgradeItem);
  const craftItem = useSession((s) => s.craftItem);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const maxTier = workshopMaxTier(level);
  const owned = new Set(save.characters.map((c) => c.classId));
  // Onglets : les classes de l'équipe, et celles dont on garde des objets.
  const classes = CLASS_IDS.filter(
    (id) => owned.has(id) || save.items.some((i) => catalogItem(i.catalogId).classId === id),
  );
  const [classId, setClassId] = useState<ClassId>(save.characters[0]!.classId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [craft, setCraft] = useState<{ slot: SlotId; tier: number }>({
    slot: 'weapon1',
    tier: 1,
  });
  const [pending, setPending] = useState(false);

  const run = async <T,>(action: () => Promise<T>, success: string | ((result: T) => string)) => {
    setPending(true);
    try {
      const result = await action();
      notify('success', typeof success === 'string' ? success : success(result));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const owner = save.characters.find((c) => c.classId === classId) ?? null;
  const classItems = save.items.filter((i) => catalogItem(i.catalogId).classId === classId);
  const inventory = classItems.filter((i) => !i.equippedBy).sort(compareItems);
  const selected = classItems.find((i) => i.id === selectedId) ?? null;
  const have = (resourceId: string) => view.resources[resourceId] ?? 0;

  const selectClass = (id: ClassId) => {
    setClassId(id);
    setSelectedId(null);
  };

  /** Ligne d'objet cliquable du milieu, avec le coût du prochain niveau. */
  const itemRow = (item: ItemDto, label?: string) => {
    const info = catalogItem(item.catalogId);
    const cost = workshopUpgradeCost(gameData.equipment, info, item.upgradeLevel, level);
    const locked = itemWorkTier(gameData.equipment, info, item.upgradeLevel) > maxTier;
    return (
      <li key={item.id}>
        <button
          type="button"
          className={`workshop-item${item.id === selectedId ? ' selected' : ''}`}
          aria-pressed={item.id === selectedId}
          onClick={() => setSelectedId(item.id)}
        >
          <Tooltip content={<ItemTooltip item={item} save={save} resources={view.resources} />}>
            <span>
              <ItemIcon catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
            </span>
          </Tooltip>
          <span className="workshop-item-text">
            {label && <span className="slot-label">{label}</span>}
            <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
          </span>
          <span
            className={`small ${cost && !locked && have(cost.resourceId) < cost.quantity ? 'missing' : 'muted'}`}
          >
            {!cost
              ? t('workshop.maxShort')
              : locked
                ? t('workshop.lockedShort')
                : `${formatNumber(cost.quantity)} ${resourceById(cost.resourceId)?.name ?? ''}`}
          </span>
        </button>
      </li>
    );
  };

  // Fabrication : objet Commun +0 de la classe choisie.
  const craftTarget = gameData.equipment.catalog.find(
    (c) =>
      c.classId === classId &&
      c.slot === craft.slot &&
      c.tier === craft.tier &&
      c.rarity === 'common',
  );
  const craftPrice = craftTarget ? craftCost(gameData, craftTarget) : null;
  const craftMissing = craftPrice ? have(craftPrice.resourceId) < craftPrice.quantity : true;
  const craftPreview: ItemDto | null = craftTarget
    ? { id: 'preview', catalogId: craftTarget.id, upgradeLevel: 0, equippedBy: null, slot: null }
    : null;
  const craftReference = owner ? equippedIn(save, owner.id, craft.slot) : null;
  const craftChances = craftRarityChances(level);

  // Amélioration de l'objet choisi.
  const selectedInfo = selected ? catalogItem(selected.catalogId) : null;
  const upgradeCost =
    selected && selectedInfo
      ? workshopUpgradeCost(gameData.equipment, selectedInfo, selected.upgradeLevel, level)
      : null;
  const upgradeTier =
    selected && selectedInfo
      ? itemWorkTier(gameData.equipment, selectedInfo, selected.upgradeLevel)
      : 0;
  const upgradeLocked = upgradeTier > maxTier;
  const upgradeMissing = upgradeCost ? have(upgradeCost.resourceId) < upgradeCost.quantity : true;

  return (
    <div className="workshop">
      <div className="workshop-toolbar">
        <div className="tabs" role="tablist">
          {classes.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === classId}
              className={id === classId ? 'toggled' : ''}
              onClick={() => selectClass(id)}
            >
              {t(`class.name.${id}`)}
            </button>
          ))}
        </div>
        <span className="muted small">{t('workshop.tiers', { tier: maxTier })}</span>
      </div>

      <div className="workshop-columns">
        <section className="workshop-column">
          <h3>{t('workshop.craft')}</h3>
          {owner ? (
            <>
              <div className="craft-form">
                <select
                  aria-label={t('debug.slot')}
                  value={craft.slot}
                  onChange={(e) => setCraft({ ...craft, slot: e.target.value as SlotId })}
                >
                  {SLOT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(`slot.${id}`)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('debug.tier')}
                  value={craft.tier}
                  onChange={(e) => setCraft({ ...craft, tier: Number(e.target.value) })}
                >
                  {Array.from({ length: maxTier }, (_, i) => i + 1).map((tier) => (
                    <option key={tier} value={tier}>
                      {t('workshop.tier', { tier })}
                    </option>
                  ))}
                </select>
              </div>
              {craftTarget && craftPreview && craftPrice && (
                <div className="workshop-preview">
                  <Tooltip
                    content={
                      <ItemTooltip
                        item={craftPreview}
                        save={save}
                        resources={view.resources}
                        compareWith={owner.id}
                      />
                    }
                  >
                    <span tabIndex={0}>
                      <ItemIcon catalogId={craftTarget.id} scale={2} />
                    </span>
                  </Tooltip>
                  <ItemName catalogId={craftTarget.id} />
                  <span className="muted small">
                    {craftReference
                      ? t('item.compareWith', { name: catalogItem(craftReference.catalogId).name })
                      : t('outcome.slotEmpty')}
                  </span>
                  <StatDeltas candidate={craftPreview} reference={craftReference} />
                  <ResourceCost
                    resourceId={craftPrice.resourceId}
                    quantity={craftPrice.quantity}
                    have={have(craftPrice.resourceId)}
                  />
                  <p className="muted small">{t('workshop.craftChances')}</p>
                  <ul className="craft-chances">
                    {RARITY_IDS.filter((r) => craftChances[r] > 0).map((r) => (
                      <li key={r} style={{ color: rarityInfo(r).color }}>
                        {rarityInfo(r).name} {formatChance(craftChances[r])}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="primary"
                disabled={pending || !craftTarget || craftMissing}
                onClick={() =>
                  craftTarget &&
                  void run(
                    () => craftItem({ classId, ...craft }),
                    // L'objet obtenu est annoncé avec sa rareté.
                    (crafted) => {
                      const info = crafted ? catalogItem(crafted.catalogId) : craftTarget;
                      return t('workshop.crafted', {
                        name: info.name,
                        rarity: rarityInfo(info.rarity).name,
                      });
                    },
                  )
                }
              >
                {t('workshop.craftButton')}
              </button>
            </>
          ) : (
            <p className="warning">{t('workshop.noHero', { class: t(`class.name.${classId}`) })}</p>
          )}
        </section>

        <section className="workshop-column">
          <h3>{t('workshop.items', { class: t(`class.name.${classId}`) })}</h3>
          {owner && (
            <>
              <h4>{t('team.equipment')}</h4>
              <ul className="workshop-list">
                {SLOT_IDS.map((slot) => {
                  const item = equippedIn(save, owner.id, slot);
                  return item ? (
                    itemRow(item, t(`slot.${slot}`))
                  ) : (
                    <li key={slot} className="workshop-empty muted small">
                      {t(`slot.${slot}`)} · {t('team.slotEmpty')}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <h4>{t('team.inventory')}</h4>
          {inventory.length === 0 ? (
            <p className="muted small">{t('team.noItems')}</p>
          ) : (
            <ul className="workshop-list">
              {inventory.map((item) =>
                itemRow(item, t(`slot.${catalogItem(item.catalogId).slot}`)),
              )}
            </ul>
          )}
        </section>

        <section className="workshop-column">
          <h3>{t('workshop.upgrade')}</h3>
          {selected && selectedInfo ? (
            <div className="workshop-preview">
              <ItemIcon
                catalogId={selected.catalogId}
                upgradeLevel={selected.upgradeLevel}
                scale={2}
              />
              <ItemName catalogId={selected.catalogId} upgradeLevel={selected.upgradeLevel} />
              {!upgradeCost ? (
                <p className="ok">{t('item.maxed')}</p>
              ) : upgradeLocked ? (
                <p className="error">{t('item.tierLocked', { tier: upgradeTier })}</p>
              ) : (
                <>
                  <span>
                    {t('workshop.levelChange', {
                      from: selected.upgradeLevel,
                      to: selected.upgradeLevel + 1,
                    })}
                  </span>
                  <StatDeltas
                    candidate={{ ...selected, upgradeLevel: selected.upgradeLevel + 1 }}
                    reference={selected}
                  />
                  <ResourceCost
                    resourceId={upgradeCost.resourceId}
                    quantity={upgradeCost.quantity}
                    have={have(upgradeCost.resourceId)}
                  />
                </>
              )}
              <button
                type="button"
                className="primary"
                disabled={pending || !upgradeCost || upgradeLocked || upgradeMissing}
                onClick={() =>
                  void run(
                    () => upgradeItem(selected.id),
                    t('workshop.upgraded', {
                      name: selectedInfo.name,
                      level: selected.upgradeLevel + 1,
                    }),
                  )
                }
              >
                {t('building.upgrade')}
              </button>
            </div>
          ) : (
            <p className="muted">{t('workshop.pickItem')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
