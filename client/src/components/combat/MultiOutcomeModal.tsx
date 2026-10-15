import type { MultiOutcome } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect } from 'react';
import { playOutcomeSounds } from '../../game/sound.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import { useSession } from '../../stores/session.ts';
import { ItemIcon } from '../items/ItemIcon.tsx';
import { ItemName } from '../items/ItemTooltip.tsx';
import { Modal } from '../Modal.tsx';
import { Tooltip } from '../Tooltip.tsx';
import { RelicIcon, RelicTooltip } from '../relics/RelicIcon.tsx';
import { LootRow, RelicDrops, defeatAdvice } from './OutcomeModal.tsx';

interface Props {
  outcome: MultiOutcome;
  onRoom: () => void;
  onVillage: () => void;
}

/**
 * Fin d'un combat multijoueur : ce que chaque joueur a obtenu (XP, or, niveau, étage, butin),
 * visible par tous, puis le butin du joueur avec la comparaison et le bouton Équiper.
 */
export function MultiOutcomeModal({ outcome, onRoom, onVillage }: Props) {
  const userId = useSession((s) => s.user?.id);
  const mine = outcome.players.find((p) => p.userId === userId);
  const zoneName = gameData.zones.zones.find((z) => z.floor === outcome.floor)?.name ?? '';
  const unlocked = mine?.unlocked;

  useEffect(() => {
    playOutcomeSounds(outcome.result, !!mine?.levelUp, mine?.loot.length ?? 0);
    // Une seule fois, à l'ouverture du bilan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  return (
    <Modal
      open
      onClose={onRoom}
      title={
        <span className={`outcome-title ${outcome.result}`}>{t(`outcome.${outcome.result}`)}</span>
      }
      className="outcome"
    >
      {outcome.result === 'victory' && <p>{t('outcome.multiVictory', { floor: outcome.floor })}</p>}
      {outcome.result === 'retreat' && <p>{t('outcome.huntEnded', { zone: zoneName })}</p>}
      {outcome.result === 'defeat' && <p className="warning">{t(defeatAdvice(outcome.mode))}</p>}

      <section>
        <h3>{t('outcome.whoGotWhat')}</h3>
        <ul className="who-got-what">
          {outcome.players.map((p) => (
            <li key={p.userId} className={p.userId === userId ? 'mine' : ''}>
              <div>
                <strong>{p.username}</strong>
                {p.classId && <span className="muted"> · {t(`class.name.${p.classId}`)}</span>}
                <span>
                  {' '}
                  · {t('outcome.multiLine', { xp: formatNumber(p.xp), gold: formatNumber(p.gold) })}
                </span>
                {p.levelUp && (
                  <strong className="ok level-up">
                    {' '}
                    · {t('outcome.levelUp', { level: p.levelUp.to })}
                  </strong>
                )}
                {p.floorCleared && <span className="accent"> · {t('outcome.floorUp')}</span>}
                {p.withdrawn && <span className="muted"> · {t('outcome.withdrawnTag')}</span>}
              </div>
              <div className="who-loot">
                {p.relics.map((id) => (
                  <Tooltip key={id} content={<RelicTooltip relicId={id} />}>
                    <span tabIndex={0}>
                      <RelicIcon relicId={id} size={34} />
                    </span>
                  </Tooltip>
                ))}
                {p.loot.length === 0 && p.relics.length === 0 ? (
                  <span className="muted small">{t('outcome.noLoot')}</span>
                ) : (
                  p.loot.map((drop) => (
                    <Tooltip key={drop.itemId} content={<ItemName catalogId={drop.catalogId} />}>
                      <span tabIndex={0}>
                        <ItemIcon catalogId={drop.catalogId} scale={1.2} />
                      </span>
                    </Tooltip>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {mine && mine.relics.length > 0 && <RelicDrops relicIds={mine.relics} />}
      {mine && mine.loot.length > 0 && (
        <section>
          <h3>{t('outcome.yourLoot')}</h3>
          <p className="muted small">{t('outcome.lootHint')}</p>
          <ul className="outcome-loot">
            {mine.loot.map((drop, index) => (
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

      {unlocked &&
        (unlocked.elements.length > 0 ||
          unlocked.buildings.length > 0 ||
          unlocked.huntingZones.length > 0) && (
          <section>
            <h3>{t('outcome.unlocked')}</h3>
            <ul className="outcome-unlocks">
              {unlocked.elements.map((id) => (
                <li key={id}>
                  {t('outcome.unlockedElement', {
                    name: gameData.elements.elements.find((e) => e.id === id)?.name ?? id,
                  })}
                </li>
              ))}
              {unlocked.buildings.map((id) => (
                <li key={id}>
                  {t('outcome.unlockedBuilding', {
                    name: gameData.village.buildings.find((b) => b.id === id)?.name ?? id,
                  })}
                </li>
              ))}
              {unlocked.huntingZones.map((name) => (
                <li key={name}>{t('outcome.unlockedZone', { name })}</li>
              ))}
            </ul>
          </section>
        )}

      <div className="modal-actions">
        <button type="button" className="primary" onClick={onRoom}>
          {t('outcome.toRoom')}
        </button>
        <button type="button" onClick={onVillage}>
          {t('outcome.toVillage')}
        </button>
      </div>
    </Modal>
  );
}
