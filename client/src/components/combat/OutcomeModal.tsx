import { STAT_POINTS, type CombatOutcome } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { catalogItem, equippedIn } from '../../game/items.ts';
import { useVillageView } from '../../game/village.ts';
import { errorMessage, formatNumber, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';
import { ItemIcon } from '../items/ItemIcon.tsx';
import { ItemName, ItemTooltip } from '../items/ItemTooltip.tsx';
import { StatDeltas } from '../items/StatDeltas.tsx';
import { Modal } from '../Modal.tsx';
import { Tooltip } from '../Tooltip.tsx';

interface Action {
  label: string;
  run: () => void;
}

interface Props {
  outcome: CombatOutcome;
  onVillage: () => void;
  /** Retour à la tour (ou aux zones de chasse après une chasse). */
  onTower: () => void;
  onTeam: () => void;
  /** Enchaîner : étage suivant ou nouvelle chasse. */
  next: Action | null;
  /** Rejouer l'étage (boss et dragons). */
  replay: Action | null;
}

/**
 * Objet tombé : comparaison avec l'objet porté par le héros de sa classe et bouton Équiper.
 * Lit la sauvegarde à jour (pas celle de la fin de combat) pour suivre les objets équipés ici.
 */
export function LootRow({ itemId, catalogId }: { itemId: string; catalogId: string }) {
  const save = useSession((s) => s.save);
  const equipItem = useSession((s) => s.equipItem);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);
  const info = catalogItem(catalogId);
  const item = save?.items.find((i) => i.id === itemId);
  const hero = save?.characters.find((c) => c.classId === info.classId);
  const className = t(`class.name.${info.classId}`);

  if (!save || !item) {
    return (
      <li>
        <ItemIcon catalogId={catalogId} scale={1.5} />
        <ItemName catalogId={catalogId} />
      </li>
    );
  }
  const equipped = !!hero && item.equippedBy === hero.id;
  const reference = hero && !equipped ? equippedIn(save, hero.id, info.slot) : null;

  const equip = async () => {
    if (!hero) return;
    setPending(true);
    try {
      await equipItem(item.id, hero.id);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <li>
      <Tooltip
        content={
          <ItemTooltip item={item} save={save} resources={view.resources} compareWith={hero?.id} />
        }
      >
        <span tabIndex={0}>
          <ItemIcon catalogId={catalogId} scale={1.5} />
        </span>
      </Tooltip>
      <span className="inventory-row-main">
        <span>
          <ItemName catalogId={catalogId} />{' '}
          <span className="muted small">
            {className} · {t(`slot.${info.slot}`)}
          </span>
        </span>
        {hero ? (
          !equipped && (
            <>
              <span className="muted small">
                {reference
                  ? t('item.compareWith', { name: catalogItem(reference.catalogId).name })
                  : t('outcome.slotEmpty')}
              </span>
              <StatDeltas candidate={item} reference={reference} />
            </>
          )
        ) : (
          <span className="muted small">{t('outcome.noHero', { class: className })}</span>
        )}
      </span>
      {hero &&
        (equipped ? (
          <strong className="ok">{t('outcome.equipped')}</strong>
        ) : (
          <button type="button" disabled={pending} onClick={() => void equip()}>
            {t('outcome.equip')}
          </button>
        ))}
    </li>
  );
}

/** Fin de combat : victoire, défaite ou fin de chasse ; or, XP, montées de niveau et déblocages. */
export function OutcomeModal({ outcome, onVillage, onTower, onTeam, next, replay }: Props) {
  const characters = useSession((s) => s.save?.characters ?? []);
  const classOf = (id: string) => characters.find((c) => c.id === id)?.classId;
  const { elements, buildings, huntingZones } = outcome.unlocked;
  const zoneName = gameData.zones.zones.find((z) => z.floor === outcome.floor)?.name ?? '';

  return (
    <Modal open onClose={onTower} title={t(`outcome.${outcome.result}`)} className="outcome">
      {outcome.result === 'victory' && (
        <p>
          {outcome.floorCleared
            ? t('outcome.floorCleared', { floor: outcome.floor })
            : t('outcome.replayed', { floor: outcome.floor })}
        </p>
      )}
      {outcome.result === 'retreat' && <p>{t('outcome.huntEnded', { zone: zoneName })}</p>}
      {outcome.result === 'defeat' && (
        <p className="warning">
          {t(outcome.mode === 'hunt' ? 'outcome.huntDefeat' : 'outcome.defeatAdvice')}
        </p>
      )}
      <ul className="outcome-rewards">
        <li>
          <span className="gold-icon" aria-hidden="true" />
          {t('outcome.gold', { gold: formatNumber(outcome.gold) })}
        </li>
        {Object.entries(outcome.xp).map(([id, xp]) => {
          const classId = classOf(id);
          const levelUp = outcome.levelUps.find((l) => l.characterId === id);
          return (
            <li key={id}>
              {classId ? t(`class.name.${classId}`) : ''} :{' '}
              {t('outcome.xp', { xp: formatNumber(xp) })}
              {levelUp && (
                <strong className="ok">
                  {' '}
                  {t('outcome.levelUp', { level: levelUp.to })}{' '}
                  {t('outcome.points', {
                    points: (levelUp.to - levelUp.from) * STAT_POINTS.perLevel,
                  })}
                </strong>
              )}
            </li>
          );
        })}
      </ul>
      {outcome.loot.length > 0 && (
        <section>
          <h3>{t('outcome.loot')}</h3>
          <p className="muted small">{t('outcome.lootHint')}</p>
          <ul className="outcome-loot">
            {outcome.loot.map((drop) => (
              <LootRow key={drop.itemId} itemId={drop.itemId} catalogId={drop.catalogId} />
            ))}
          </ul>
        </section>
      )}
      {(elements.length > 0 || buildings.length > 0 || huntingZones.length > 0) && (
        <section>
          <h3>{t('outcome.unlocked')}</h3>
          <ul className="outcome-unlocks">
            {elements.map((id) => (
              <li key={id}>
                {t('outcome.unlockedElement', {
                  name: gameData.elements.elements.find((e) => e.id === id)?.name ?? id,
                })}
              </li>
            ))}
            {buildings.map((id) => (
              <li key={id}>
                {t('outcome.unlockedBuilding', {
                  name: gameData.village.buildings.find((b) => b.id === id)?.name ?? id,
                })}
              </li>
            ))}
            {huntingZones.map((name) => (
              <li key={name}>{t('outcome.unlockedZone', { name })}</li>
            ))}
          </ul>
        </section>
      )}
      {/* Navigation à gauche ; enchaîner (rejouer, étage suivant) à droite. */}
      <div className="modal-actions outcome-actions">
        <button type="button" onClick={onVillage}>
          {t('outcome.toVillage')}
        </button>
        <button type="button" onClick={onTower}>
          {t(outcome.mode === 'hunt' ? 'outcome.toHunt' : 'outcome.toTower')}
        </button>
        <button type="button" onClick={onTeam}>
          {t('outcome.toTeam')}
        </button>
        <span className="outcome-actions-spacer" />
        {replay && (
          <button type="button" className={next ? '' : 'primary'} onClick={replay.run}>
            {replay.label}
          </button>
        )}
        {next && (
          <button type="button" className="primary" onClick={next.run}>
            {next.label}
          </button>
        )}
      </div>
    </Modal>
  );
}
