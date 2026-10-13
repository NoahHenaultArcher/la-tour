import { STAT_POINTS, type CombatOutcome } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { formatNumber, t } from '../../i18n/index.ts';
import { useSession } from '../../stores/session.ts';
import { ItemIcon } from '../items/ItemIcon.tsx';
import { ItemName } from '../items/ItemTooltip.tsx';
import { Modal } from '../Modal.tsx';

interface Props {
  outcome: CombatOutcome;
  onVillage: () => void;
  /** Retour à la tour (ou aux zones de chasse après une chasse). */
  onTower: () => void;
  /** Enchaîner : étage suivant ou nouvelle chasse. */
  next: { label: string; run: () => void } | null;
}

/** Fin de combat : victoire, défaite ou fin de chasse ; or, XP, montées de niveau et déblocages. */
export function OutcomeModal({ outcome, onVillage, onTower, next }: Props) {
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
          <ul className="outcome-loot">
            {outcome.loot.map((drop) => (
              <li key={drop.itemId}>
                <ItemIcon catalogId={drop.catalogId} scale={1.5} />
                <ItemName catalogId={drop.catalogId} />
              </li>
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
      <div className="modal-actions">
        {next && (
          <button type="button" className="primary" onClick={next.run}>
            {next.label}
          </button>
        )}
        <button type="button" onClick={onTower}>
          {t(outcome.mode === 'hunt' ? 'outcome.toHunt' : 'outcome.toTower')}
        </button>
        <button type="button" onClick={onVillage}>
          {t('outcome.toVillage')}
        </button>
      </div>
    </Modal>
  );
}
