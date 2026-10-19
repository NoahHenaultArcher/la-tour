import {
  STAT_POINTS,
  relicById,
  sellPrice,
  type CombatMode,
  type CombatOutcome,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, useState, type CSSProperties } from 'react';
import { catalogItem, equippedIn, rarityInfo } from '../../game/items.ts';
import { playOutcomeSounds } from '../../game/sound.ts';
import { useVillageView } from '../../game/village.ts';
import { errorMessage, formatNumber, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';
import { ItemIcon } from '../items/ItemIcon.tsx';
import { ItemName, ItemTooltip } from '../items/ItemTooltip.tsx';
import { StatDeltas } from '../items/StatDeltas.tsx';
import { Modal } from '../Modal.tsx';
import { RelicIcon, RelicTooltip } from '../relics/RelicIcon.tsx';
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
  /** « Poursuivre » : lance l'enchaînement automatique des étages (null si impossible ou déjà lancé). */
  onChain: (() => void) | null;
  /** Enchaînement en cours : secondes avant l'étage suivant (null sinon). */
  chainSeconds: number | null;
  onStopChain: () => void;
}

/**
 * Objet tombé : comparaison avec l'objet porté par le héros de sa classe et bouton Équiper.
 * Lit la sauvegarde à jour (pas celle de la fin de combat) pour suivre les objets équipés ici.
 */
export function LootRow({
  itemId,
  catalogId,
  index = 0,
}: {
  itemId: string;
  catalogId: string;
  /** Rang dans la liste : les objets apparaissent l'un après l'autre. */
  index?: number;
}) {
  const save = useSession((s) => s.save);
  const equipItem = useSession((s) => s.equipItem);
  const sellItem = useSession((s) => s.sellItem);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);
  /** Or reçu si l'objet a été vendu depuis cette fenêtre. */
  const [soldFor, setSoldFor] = useState<number | null>(null);
  const info = catalogItem(catalogId);
  const item = save?.items.find((i) => i.id === itemId);
  const hero = save?.characters.find((c) => c.classId === info.classId);
  const className = t(`class.name.${info.classId}`);
  // Apparition du butin : décalée selon le rang, lueur de la couleur de la rareté.
  const reveal = {
    '--i': index,
    '--rarity': rarityInfo(info.rarity).color,
  } as CSSProperties;

  if (!save || !item) {
    return (
      <li className="loot-reveal" style={reveal}>
        <ItemIcon catalogId={catalogId} scale={1.5} />
        <ItemName catalogId={catalogId} />
        {soldFor !== null && (
          <strong className="muted outcome-sold">
            {t('outcome.sold', { gold: formatNumber(soldFor) })}
          </strong>
        )}
      </li>
    );
  }
  const equipped = !!hero && item.equippedBy === hero.id;
  const reference = hero && !equipped ? equippedIn(save, hero.id, info.slot) : null;

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
  const equip = () =>
    run(async () => {
      if (hero) await equipItem(item.id, hero.id);
    });
  const sell = () =>
    run(async () => {
      const gold = await sellItem(item.id);
      setSoldFor(gold);
      notify('success', t('team.sold', { name: info.name, gold: formatNumber(gold) }));
    });

  return (
    <li className="loot-reveal" style={reveal}>
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
              <StatDeltas candidate={item} reference={reference} wearerId={hero?.id} />
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
      {/* Vendre tout de suite évite de stocker l'objet puis de passer par la page Équipe. */}
      {!item.equippedBy && (
        <button type="button" className="danger" disabled={pending} onClick={() => void sell()}>
          {t('team.sell', {
            price: formatNumber(sellPrice(gameData, info, item.upgradeLevel)),
          })}
        </button>
      )}
    </li>
  );
}

/** Fin de combat : victoire, défaite ou fin de chasse ; or, XP, montées de niveau et déblocages. */
/** Reliques et œufs obtenus : mis en avant (rares, une seule fois par compte). */
export function RelicDrops({ relicIds }: { relicIds: string[] }) {
  return (
    <section className="relic-drops">
      <h3>{t('relic.dropped')}</h3>
      <ul>
        {relicIds.map((id) => (
          <li key={id}>
            <Tooltip content={<RelicTooltip relicId={id} />}>
              <span tabIndex={0}>
                <RelicIcon relicId={id} />
              </span>
            </Tooltip>
            <span>
              <strong className={`relic-name ${relicById(id)?.kind ?? ''}`}>
                {relicById(id)?.name}
              </strong>
              <span className="muted small"> {t('relic.droppedHint')}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Conseil après une défaite, selon le contenu joué. */
export function defeatAdvice(mode: CombatMode) {
  return mode === 'hunt'
    ? 'outcome.huntDefeat'
    : mode === 'abyss'
      ? 'outcome.abyssDefeat'
      : 'outcome.defeatAdvice';
}

export function OutcomeModal({
  outcome,
  onVillage,
  onTower,
  onTeam,
  next,
  replay,
  onChain,
  chainSeconds,
  onStopChain,
}: Props) {
  const characters = useSession((s) => s.save?.characters ?? []);
  const classOf = (id: string) => characters.find((c) => c.id === id)?.classId;
  const { elements, buildings, huntingZones } = outcome.unlocked;
  const zoneName = gameData.zones.zones.find((z) => z.floor === outcome.floor)?.name ?? '';

  useEffect(() => {
    playOutcomeSounds(outcome.result, outcome.levelUps.length > 0, outcome.loot.length);
  }, [outcome]);

  return (
    <Modal
      open
      onClose={onTower}
      title={
        <span className={`outcome-title ${outcome.result}`}>{t(`outcome.${outcome.result}`)}</span>
      }
      className="outcome"
    >
      {outcome.result === 'victory' && (
        <p>
          {outcome.mode === 'abyss'
            ? t('outcome.abyssCleared', { floor: outcome.floor })
            : outcome.floorCleared
              ? t('outcome.floorCleared', { floor: outcome.floor })
              : t('outcome.replayed', { floor: outcome.floor })}
        </p>
      )}
      {outcome.result === 'retreat' && <p>{t('outcome.huntEnded', { zone: zoneName })}</p>}
      {outcome.result === 'defeat' && <p className="warning">{t(defeatAdvice(outcome.mode))}</p>}
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
                <strong className="ok level-up">
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
      {outcome.relics.length > 0 && <RelicDrops relicIds={outcome.relics} />}
      {outcome.loot.length > 0 && (
        <section>
          <h3>{t('outcome.loot')}</h3>
          <p className="muted small">{t('outcome.lootHint')}</p>
          <ul className="outcome-loot">
            {outcome.loot.map((drop, index) => (
              <LootRow
                key={drop.itemId}
                itemId={drop.itemId}
                catalogId={drop.catalogId}
                index={index}
              />
            ))}
          </ul>
        </section>
      )}
      {(elements.length > 0 ||
        buildings.length > 0 ||
        huntingZones.length > 0 ||
        outcome.unlocked.abyss) && (
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
            {outcome.unlocked.abyss && (
              <li className="abyss-unlock">{t('outcome.unlockedAbyss')}</li>
            )}
          </ul>
        </section>
      )}
      {chainSeconds !== null && (
        <div className="chain-countdown" role="status">
          <span>{t('outcome.chainCountdown', { seconds: chainSeconds })}</span>
          <button type="button" className="danger" onClick={onStopChain}>
            {t('outcome.chainStop')}
          </button>
        </div>
      )}
      {/* Navigation à gauche ; enchaîner (rejouer, étage suivant) à droite. */}
      <div className="modal-actions outcome-actions">
        <button type="button" onClick={onVillage}>
          {t('outcome.toVillage')}
        </button>
        <button type="button" onClick={onTower}>
          {t(
            outcome.mode === 'hunt'
              ? 'outcome.toHunt'
              : outcome.mode === 'abyss'
                ? 'outcome.toAbyss'
                : 'outcome.toTower',
          )}
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
          <button type="button" className={onChain ? '' : 'primary'} onClick={next.run}>
            {next.label}
          </button>
        )}
        {onChain && (
          <button
            type="button"
            className="primary"
            title={t('outcome.chainHint')}
            onClick={onChain}
          >
            {t('outcome.chain')}
          </button>
        )}
      </div>
    </Modal>
  );
}
