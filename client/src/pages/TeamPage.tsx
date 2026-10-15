import {
  CLASS_IDS,
  RARITY_IDS,
  SLOT_IDS,
  STAT_IDS,
  sellPrice,
  type ClassId,
  type ItemDto,
  type SaveDto,
  type SlotId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { ItemIcon } from '../components/items/ItemIcon.tsx';
import { ItemName, ItemTooltip } from '../components/items/ItemTooltip.tsx';
import { StatDeltas } from '../components/items/StatDeltas.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { RelicsPanel } from '../components/relics/RelicsPanel.tsx';
import { StatSheet } from '../components/team/StatSheet.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { catalogItem, equippedIn, formatStat, statInfo, statsOf } from '../game/items.ts';
import { useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

const priceOf = (item: ItemDto) =>
  sellPrice(gameData, catalogItem(item.catalogId), item.upgradeLevel);

/** Ordre de l'inventaire : par emplacement, puis du plus fort au plus faible. */
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

/** Deux stats principales d'un objet porté, pour le résumé de l'emplacement. */
function statSummary(item: ItemDto): string {
  const stats = statsOf(item);
  return STAT_IDS.filter((id) => stats[id] !== 0)
    .slice(0, 2)
    .map((id) => `${statInfo(id).name} ${formatStat(id, stats[id], true)}`)
    .join(' · ');
}

/** Page Équipe : emplacements, stats détaillées, inventaire par classe avec comparaison. */
export function TeamPage() {
  const save = useSession((s) => s.save)!;
  const equipItem = useSession((s) => s.equipItem);
  const unequipItem = useSession((s) => s.unequipItem);
  const sellItem = useSession((s) => s.sellItem);
  const sellItems = useSession((s) => s.sellItems);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [characterId, setCharacterId] = useState(save.characters[0]!.id);
  const [inventoryClass, setInventoryClass] = useState<ClassId>(save.characters[0]!.classId);
  const [slot, setSlot] = useState<SlotId | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmSellAll, setConfirmSellAll] = useState(false);
  // Onglet « Reliques » (à côté des héros) : reliques et œufs de dragon de toute l'équipe.
  const [showRelics, setShowRelics] = useState(false);

  const character = save.characters.find((c) => c.id === characterId) ?? save.characters[0]!;
  // Héros qui recevrait les objets de l'onglet d'inventaire affiché (null : classe pas encore achetée).
  const owner = save.characters.find((c) => c.classId === inventoryClass) ?? null;

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const unequipped = save.items.filter((i) => !i.equippedBy);
  const countFor = (classId: ClassId) =>
    unequipped.filter((i) => catalogItem(i.catalogId).classId === classId).length;
  const shown = unequipped
    .filter((i) => {
      const info = catalogItem(i.catalogId);
      return info.classId === inventoryClass && (!slot || info.slot === slot);
    })
    .sort(compareItems);
  const shownValue = shown.reduce((sum, item) => sum + priceOf(item), 0);

  const selectCharacter = (id: string) => {
    const next = save.characters.find((c) => c.id === id)!;
    setCharacterId(id);
    setInventoryClass(next.classId);
    setSlot(null);
    setConfirmSellAll(false);
  };

  const sellOne = (item: ItemDto) =>
    void run(async () => {
      const gold = await sellItem(item.id);
      notify(
        'success',
        t('team.sold', { name: catalogItem(item.catalogId).name, gold: formatNumber(gold) }),
      );
    });

  const sellAll = () =>
    void run(async () => {
      const gold = await sellItems(shown.map((i) => i.id));
      setConfirmSellAll(false);
      notify('success', t('team.soldMany', { count: shown.length, gold: formatNumber(gold) }));
    });

  return (
    <div className="page">
      <TopBar />
      <main className="team-page">
        <header className="team-header">
          <h1>{t('team.title')}</h1>
          <div className="tabs" role="tablist">
            {save.characters.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={!showRelics && c.id === character.id}
                className={!showRelics && c.id === character.id ? 'toggled' : ''}
                onClick={() => {
                  setShowRelics(false);
                  selectCharacter(c.id);
                }}
              >
                {t(`class.name.${c.classId}`)}
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={showRelics}
              className={`relic-tab${showRelics ? ' toggled' : ''}`}
              onClick={() => setShowRelics(true)}
            >
              {t('relic.tab')}
            </button>
          </div>
        </header>
        {showRelics ? (
          <RelicsPanel save={save} />
        ) : (
          <>
            <section className="panel hero-sheet">
              <div className="hero-identity">
                <PixelImage src={CLASS_IMAGES[character.classId]} alt="" size={96} />
                <div>
                  <h2>{t(`class.name.${character.classId}`)}</h2>
                  <p>{t('home.level', { level: character.level })}</p>
                  <p className="muted">
                    {character.xpToNextLevel === null
                      ? t('home.xpMax')
                      : t('home.xp', {
                          xp: formatNumber(character.xp),
                          next: formatNumber(character.xpToNextLevel),
                        })}
                  </p>
                </div>
              </div>
              {/* La clé remet l'aperçu à zéro quand on change de personnage. */}
              <StatSheet key={character.id} save={save} character={character} />
              <p className="muted small">{t('team.statsNote')}</p>
            </section>

            <section className="panel equipment-panel">
              <h2>{t('team.equipment')}</h2>
              <p className="muted small">{t('team.slotHint')}</p>
              <div className="slot-list">
                {SLOT_IDS.map((id) => {
                  const item = equippedIn(save, character.id, id);
                  const selected = slot === id && inventoryClass === character.classId;
                  return (
                    <div
                      key={id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      className={`slot-row${selected ? ' selected' : ''}`}
                      onClick={() => {
                        setInventoryClass(character.classId);
                        setSlot(selected ? null : id);
                        setConfirmSellAll(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.currentTarget.click();
                        }
                      }}
                    >
                      {item ? (
                        <Tooltip
                          content={
                            <ItemTooltip item={item} save={save} resources={view.resources} />
                          }
                        >
                          <span>
                            <ItemIcon catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="slot-empty" />
                      )}
                      <span className="slot-row-text">
                        <span className="slot-label">{t(`slot.${id}`)}</span>
                        {item ? (
                          <>
                            <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
                            <span className="slot-summary">{statSummary(item)}</span>
                          </>
                        ) : (
                          <span className="slot-empty-text">{t('team.slotEmpty')}</span>
                        )}
                      </span>
                      {item && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={(e) => {
                            e.stopPropagation();
                            void run(() => unequipItem(item.id));
                          }}
                        >
                          {t('team.unequip')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel inventory-panel">
              <h2>{t('team.inventory')}</h2>
              <div className="tabs inventory-toolbar" role="tablist">
                {CLASS_IDS.map((classId) => (
                  <button
                    key={classId}
                    type="button"
                    role="tab"
                    aria-selected={classId === inventoryClass}
                    className={classId === inventoryClass ? 'toggled' : ''}
                    onClick={() => {
                      setInventoryClass(classId);
                      setSlot(null);
                      setConfirmSellAll(false);
                    }}
                  >
                    {t(`class.name.${classId}`)}
                    <span className="tab-count">{countFor(classId)}</span>
                  </button>
                ))}
              </div>
              <div className="inventory-toolbar">
                <select
                  value={slot ?? ''}
                  aria-label={t('team.filterAll')}
                  onChange={(e) => {
                    setSlot((e.target.value || null) as SlotId | null);
                    setConfirmSellAll(false);
                  }}
                >
                  <option value="">{t('team.filterAll')}</option>
                  {SLOT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(`slot.${id}`)}
                    </option>
                  ))}
                </select>
                <span className="spacer" />
                <button
                  type="button"
                  className="danger"
                  disabled={pending || shown.length === 0}
                  onClick={() => setConfirmSellAll(true)}
                >
                  {t('team.sellAll', { count: shown.length })}
                </button>
              </div>
              {confirmSellAll && shown.length > 0 && (
                <div className="sell-all-confirm">
                  <span>
                    {t('team.sellAllConfirm', {
                      count: shown.length,
                      gold: formatNumber(shownValue),
                    })}
                  </span>
                  <button type="button" className="danger" disabled={pending} onClick={sellAll}>
                    {t('team.sellAllConfirmButton')}
                  </button>
                  <button type="button" onClick={() => setConfirmSellAll(false)}>
                    {t('team.cancel')}
                  </button>
                </div>
              )}
              {owner ? (
                <p className="muted small">
                  {t('team.compareHint', { hero: t(`class.name.${owner.classId}`) })}
                </p>
              ) : (
                <p className="warning">
                  {t('team.noHeroForClass', { class: t(`class.name.${inventoryClass}`) })}
                </p>
              )}
              {shown.length === 0 ? (
                <p className="muted">{t('team.noItems')}</p>
              ) : (
                <ul className="inventory-list">
                  {shown.map((item) => (
                    <InventoryRow
                      key={item.id}
                      item={item}
                      save={save}
                      resources={view.resources}
                      ownerId={owner?.id ?? null}
                      pending={pending}
                      onEquip={() => void run(() => equipItem(item.id, owner!.id))}
                      onSell={() => sellOne(item)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

interface InventoryRowProps {
  item: ItemDto;
  save: SaveDto;
  resources: Record<string, number>;
  /** Héros de la classe de l'objet (null : pas encore acheté, l'objet ne peut pas être équipé). */
  ownerId: string | null;
  pending: boolean;
  onEquip: () => void;
  onSell: () => void;
}

/** Ligne d'inventaire : objet, gains et pertes par rapport à l'objet porté, Équiper / Vendre. */
function InventoryRow({
  item,
  save,
  resources,
  ownerId,
  pending,
  onEquip,
  onSell,
}: InventoryRowProps) {
  const info = catalogItem(item.catalogId);
  const reference = ownerId ? equippedIn(save, ownerId, info.slot) : null;
  return (
    <li>
      <Tooltip
        content={
          <ItemTooltip item={item} save={save} resources={resources} compareWith={ownerId} />
        }
      >
        <span tabIndex={0}>
          <ItemIcon catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} scale={2} />
        </span>
      </Tooltip>
      <span className="inventory-row-main">
        <span>
          <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />{' '}
          <span className="muted small">{t(`slot.${info.slot}`)}</span>
        </span>
        {ownerId && <StatDeltas candidate={item} reference={reference} />}
      </span>
      {ownerId && (
        <button type="button" disabled={pending} onClick={onEquip}>
          {t('team.equip')}
        </button>
      )}
      <button type="button" className="danger" disabled={pending} onClick={onSell}>
        {t('team.sell', { price: formatNumber(priceOf(item)) })}
      </button>
    </li>
  );
}
