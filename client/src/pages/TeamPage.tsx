import { SLOT_IDS, sellPrice, type SlotId } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { ItemIcon } from '../components/items/ItemIcon.tsx';
import { ItemName, ItemTooltip } from '../components/items/ItemTooltip.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { SkillTooltip } from '../components/combat/SkillBar.tsx';
import { StatSheet } from '../components/team/StatSheet.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { catalogItem, equippedIn } from '../game/items.ts';
import { useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

/** Page Équipe : emplacements, stats détaillées, inventaire avec comparaison, deck. */
export function TeamPage() {
  const save = useSession((s) => s.save)!;
  const equipItem = useSession((s) => s.equipItem);
  const unequipItem = useSession((s) => s.unequipItem);
  const sellItem = useSession((s) => s.sellItem);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [characterId, setCharacterId] = useState(save.characters[0]!.id);
  const [slot, setSlot] = useState<SlotId | null>(null);
  const [pending, setPending] = useState(false);

  const character = save.characters.find((c) => c.id === characterId) ?? save.characters[0]!;

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

  const classItems = save.items.filter(
    (i) => catalogItem(i.catalogId).classId === character.classId && i.equippedBy !== character.id,
  );
  const shown = slot
    ? classItems.filter((i) => catalogItem(i.catalogId).slot === slot)
    : classItems;
  const otherClasses = save.items.filter(
    (i) => catalogItem(i.catalogId).classId !== character.classId,
  ).length;
  const selectedEquipped = slot ? equippedIn(save, character.id, slot) : null;

  const deck = [0, 1, 2, 3, 4].map(
    (position) => character.skills.find((s) => s.position === position) ?? null,
  );

  return (
    <div className="page">
      <TopBar />
      <main className="team-page">
        <header className="team-header">
          <h1>{t('team.title')}</h1>
          {save.characters.length > 1 && (
            <div className="tabs" role="tablist">
              {save.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === character.id}
                  className={c.id === character.id ? 'toggled' : ''}
                  onClick={() => {
                    setCharacterId(c.id);
                    setSlot(null);
                  }}
                >
                  {t(`class.name.${c.classId}`)}
                </button>
              ))}
            </div>
          )}
        </header>

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
          <div className="slot-grid">
            {SLOT_IDS.map((id) => {
              const item = equippedIn(save, character.id, id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`slot${slot === id ? ' selected' : ''}`}
                  onClick={() => setSlot(slot === id ? null : id)}
                >
                  {item ? (
                    <Tooltip
                      content={<ItemTooltip item={item} save={save} resources={view.resources} />}
                    >
                      <span>
                        <ItemIcon
                          catalogId={item.catalogId}
                          upgradeLevel={item.upgradeLevel}
                          scale={2.5}
                        />
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="slot-empty" />
                  )}
                  <span className="slot-label">{t(`slot.${id}`)}</span>
                </button>
              );
            })}
          </div>
          {selectedEquipped && (
            <div className="slot-detail">
              <ItemName
                catalogId={selectedEquipped.catalogId}
                upgradeLevel={selectedEquipped.upgradeLevel}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => void run(() => unequipItem(selectedEquipped.id))}
              >
                {t('team.unequip')}
              </button>
            </div>
          )}
        </section>

        <section className="panel inventory-panel">
          <h2>
            {t('team.inventory')}
            <span className="muted"> · {slot ? t(`slot.${slot}`) : t('team.allSlots')}</span>
          </h2>
          {shown.length === 0 ? (
            <p className="muted">{t('team.noItems')}</p>
          ) : (
            <ul className="inventory-list">
              {shown.map((item) => (
                <li key={item.id}>
                  <Tooltip
                    content={
                      <ItemTooltip
                        item={item}
                        save={save}
                        resources={view.resources}
                        compareWith={character.id}
                      />
                    }
                  >
                    <span className="inventory-item" tabIndex={0}>
                      <ItemIcon
                        catalogId={item.catalogId}
                        upgradeLevel={item.upgradeLevel}
                        scale={2}
                      />
                      <ItemName catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} />
                      {item.equippedBy && <em className="muted">{t('team.equippedElsewhere')}</em>}
                    </span>
                  </Tooltip>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void run(() => equipItem(item.id, character.id))}
                  >
                    {t('team.equip')}
                  </button>
                  {!item.equippedBy && (
                    <button
                      type="button"
                      className="danger"
                      disabled={pending}
                      onClick={() => {
                        const info = catalogItem(item.catalogId);
                        const price = formatNumber(sellPrice(gameData, info, item.upgradeLevel));
                        if (!window.confirm(t('team.sellConfirm', { name: info.name, price })))
                          return;
                        void run(async () => {
                          const gold = await sellItem(item.id);
                          notify(
                            'success',
                            t('team.sold', { name: info.name, gold: formatNumber(gold) }),
                          );
                        });
                      }}
                    >
                      {t('team.sell', {
                        price: formatNumber(
                          sellPrice(gameData, catalogItem(item.catalogId), item.upgradeLevel),
                        ),
                      })}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {otherClasses > 0 && (
            <p className="muted small">{t('team.otherClasses', { count: otherClasses })}</p>
          )}
        </section>

        <section className="panel deck-panel">
          <h2>{t('team.deck')}</h2>
          <div className="deck">
            {deck.map((slotSkill, position) => {
              const skill =
                slotSkill && gameData.skills.catalog.find((s) => s.id === slotSkill.skillId);
              return (
                <div key={position} className={`deck-slot${position >= 3 ? ' passive' : ''}`}>
                  <span className="muted small">
                    {position >= 3 ? t('team.passiveSlot') : t('team.activeSlot')}
                  </span>
                  {skill ? (
                    <Tooltip content={<SkillTooltip skill={skill} />}>
                      <span className="deck-skill" tabIndex={0}>
                        <PixelImage src={skill.image} alt="" size={32} />
                        {skill.name}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="muted">{t('team.emptySlot')}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">{t('team.deckNote')}</p>
        </section>
      </main>
    </div>
  );
}
