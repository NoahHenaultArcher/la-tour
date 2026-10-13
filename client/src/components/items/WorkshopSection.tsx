import {
  SLOT_IDS,
  craftCost,
  itemWorkTier,
  workshopMaxTier,
  workshopUpgradeCost,
  type ClassId,
  type SlotId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { catalogItem } from '../../game/items.ts';
import { resourceById, useVillageView } from '../../game/village.ts';
import { errorMessage, formatNumber, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';
import { Tooltip } from '../Tooltip.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { ItemName, ItemTooltip } from './ItemTooltip.tsx';

/** Contenu du panneau de l'Atelier : améliorer un objet, fabriquer un objet Commun. */
export function WorkshopSection({ level }: { level: number }) {
  const save = useSession((s) => s.save)!;
  const upgradeItem = useSession((s) => s.upgradeItem);
  const craftItem = useSession((s) => s.craftItem);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);
  const maxTier = workshopMaxTier(level);
  const ownedClasses = [...new Set(save.characters.map((c) => c.classId))];
  const [craft, setCraft] = useState<{ classId: ClassId; slot: SlotId; tier: number }>({
    classId: ownedClasses[0]!,
    slot: 'weapon1',
    tier: 1,
  });

  const run = async (action: () => Promise<void>, success: string) => {
    setPending(true);
    try {
      await action();
      notify('success', success);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const items = [...save.items].sort((a, b) => Number(!!b.equippedBy) - Number(!!a.equippedBy));
  const craftTarget = gameData.equipment.catalog.find(
    (c) =>
      c.classId === craft.classId &&
      c.slot === craft.slot &&
      c.tier === craft.tier &&
      c.rarity === 'common',
  );
  const craftPrice = craftTarget ? craftCost(gameData, craftTarget) : null;
  const craftMissing = craftPrice
    ? (view.resources[craftPrice.resourceId] ?? 0) < craftPrice.quantity
    : true;

  return (
    <>
      <section>
        <h3>{t('workshop.tiers', { tier: maxTier })}</h3>
        <h3>{t('workshop.upgrade')}</h3>
        {items.length === 0 ? (
          <p className="muted">{t('team.noItems')}</p>
        ) : (
          <ul className="workshop-list">
            {items.map((item) => {
              const info = catalogItem(item.catalogId);
              const cost = workshopUpgradeCost(gameData.equipment, info, item.upgradeLevel, level);
              const locked = itemWorkTier(gameData.equipment, info, item.upgradeLevel) > maxTier;
              const missing = cost ? (view.resources[cost.resourceId] ?? 0) < cost.quantity : false;
              return (
                <li key={item.id}>
                  <Tooltip
                    content={<ItemTooltip item={item} save={save} resources={view.resources} />}
                  >
                    <span className="inventory-item" tabIndex={0}>
                      <ItemIcon
                        catalogId={item.catalogId}
                        upgradeLevel={item.upgradeLevel}
                        scale={1.5}
                      />
                      <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
                    </span>
                  </Tooltip>
                  <span className={missing ? 'missing' : 'muted'}>
                    {!cost
                      ? t('item.maxed')
                      : locked
                        ? t('item.tierLocked', {
                            tier: itemWorkTier(gameData.equipment, info, item.upgradeLevel),
                          })
                        : `${formatNumber(cost.quantity)} ${resourceById(cost.resourceId)?.name ?? cost.resourceId}`}
                  </span>
                  <button
                    type="button"
                    disabled={pending || !cost || locked || missing}
                    onClick={() =>
                      void run(
                        () => upgradeItem(item.id),
                        t('workshop.upgraded', { name: info.name, level: item.upgradeLevel + 1 }),
                      )
                    }
                  >
                    {t('building.upgrade')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>{t('workshop.craft')}</h3>
        <div className="craft-form">
          <select
            aria-label={t('debug.class')}
            value={craft.classId}
            onChange={(e) => setCraft({ ...craft, classId: e.target.value as ClassId })}
          >
            {ownedClasses.map((id) => (
              <option key={id} value={id}>
                {t(`class.name.${id}`)}
              </option>
            ))}
          </select>
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
        {craftTarget && craftPrice && (
          <p>
            <ItemName catalogId={craftTarget.id} /> :{' '}
            <span className={craftMissing ? 'missing' : ''}>
              {formatNumber(craftPrice.quantity)} {resourceById(craftPrice.resourceId)?.name} (
              {t('workshop.have', {
                amount: formatNumber(view.resources[craftPrice.resourceId] ?? 0),
              })}
              )
            </span>
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={pending || !craftTarget || craftMissing}
          onClick={() =>
            craftTarget &&
            void run(() => craftItem(craft), t('workshop.crafted', { name: craftTarget.name }))
          }
        >
          {t('workshop.craftButton')}
        </button>
      </section>
    </>
  );
}
