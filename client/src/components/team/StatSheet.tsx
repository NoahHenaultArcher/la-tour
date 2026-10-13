import {
  ALLOCATABLE_STATS,
  STAT_POINTS,
  dodgeFromAgility,
  emptyAllocation,
  type AllocatableStat,
  type CharacterDto,
  type SaveDto,
  type StatAllocation,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { characterStats } from '../../game/items.ts';
import { errorMessage, formatNumber, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';

const percent = (value: number) =>
  `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/** Stat de combat modifiée par chaque point (la Force ou la Magie selon la classe). */
const STAT_KEYS: Record<
  AllocatableStat,
  'maxHp' | 'strength' | 'magic' | 'resistance' | 'agility'
> = {
  vitality: 'maxHp',
  strength: 'strength',
  magic: 'magic',
  resistance: 'resistance',
  agility: 'agility',
};

/** Fiche de stats d'un héros, avec la répartition des points gagnés en montant de niveau. */
export function StatSheet({ save, character }: { save: SaveDto; character: CharacterDto }) {
  const allocate = useSession((s) => s.allocateStatPoints);
  const reset = useSession((s) => s.resetStatPoints);
  const notify = useNotifications((s) => s.notify);
  const [pendingPoints, setPendingPoints] = useState<StatAllocation>(emptyAllocation);
  const [busy, setBusy] = useState(false);

  const used = ALLOCATABLE_STATS.reduce((sum, s) => sum + pendingPoints[s], 0);
  const remaining = character.statPoints.available - used;
  const preview: StatAllocation = { ...character.statPoints.allocated };
  for (const s of ALLOCATABLE_STATS) preview[s] += pendingPoints[s];
  const current = characterStats(save, character);
  const stats = characterStats(save, character, preview);

  const change = (stat: AllocatableStat, delta: number) =>
    setPendingPoints((p) => ({ ...p, [stat]: Math.max(0, p[stat] + delta) }));

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      setPendingPoints(emptyAllocation());
      notify('success', success);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const delta = (key: keyof typeof stats) =>
    stats[key] !== current[key] ? ` (+${formatNumber(stats[key] - current[key])})` : '';

  /** Ligne d'une stat qui reçoit des points : valeur, aperçu et boutons − / +. */
  const allocRow = (stat: AllocatableStat, label: string) => {
    const key = STAT_KEYS[stat];
    return (
      <tr key={stat}>
        <th>{label}</th>
        <td>
          {formatNumber(stats[key])}
          <span className="ok">{delta(key)}</span>
        </td>
        <td className="alloc-buttons">
          <span className="muted small">
            {character.statPoints.allocated[stat] + pendingPoints[stat]}
          </span>
          <button
            type="button"
            aria-label={t('team.points.remove', { stat: label })}
            disabled={busy || pendingPoints[stat] === 0}
            onClick={() => change(stat, -1)}
          >
            −
          </button>
          <button
            type="button"
            aria-label={t('team.points.add', { stat: label })}
            disabled={busy || remaining <= 0}
            onClick={() => change(stat, 1)}
          >
            +
          </button>
        </td>
      </tr>
    );
  };

  const isMage = character.classId === 'mage';
  return (
    <>
      <div className="points-header">
        <strong className={remaining > 0 ? 'accent' : 'muted'}>
          {t('team.points.available', { points: remaining })}
        </strong>
        <span className="muted small">
          {t('team.points.rule', {
            perLevel: STAT_POINTS.perLevel,
            vitality: STAT_POINTS.valuePerPoint.vitality,
          })}
        </span>
      </div>
      <table className="stat-table">
        <tbody>
          {allocRow('vitality', t('team.stat.hp'))}
          {allocRow(
            isMage ? 'magic' : 'strength',
            t(isMage ? 'team.stat.magic' : 'team.stat.strength'),
          )}
          {allocRow(
            isMage ? 'strength' : 'magic',
            t(isMage ? 'team.stat.strength' : 'team.stat.magic'),
          )}
          {allocRow('resistance', t('team.stat.resistance'))}
          {allocRow('agility', t('team.stat.agility'))}
          {(
            [
              [t('team.stat.armor'), formatNumber(stats.armor)],
              [
                t('team.stat.dodge'),
                percent(dodgeFromAgility(gameData, stats.agility, character.level)),
              ],
              [t('team.stat.initiative'), formatNumber(stats.initiative)],
              [t('team.stat.accuracy'), percent(stats.accuracy)],
              [t('team.stat.critChance'), percent(stats.critChance)],
              [t('team.stat.critDamage'), `+${percent(stats.critDamage)}`],
              [t('team.stat.penetration'), percent(stats.penetration)],
              [t('team.stat.elementalResistance'), percent(stats.elementalResistance)],
              [t('team.stat.healingBonus'), percent(stats.healingBonus)],
              [t('team.stat.statusResistance'), percent(stats.statusResistance)],
            ] as const
          ).map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="points-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || used === 0}
          onClick={() =>
            void run(() => allocate(character.id, pendingPoints), t('team.points.saved'))
          }
        >
          {t('team.points.confirm')}
        </button>
        <button
          type="button"
          disabled={busy || used === 0}
          onClick={() => setPendingPoints(emptyAllocation())}
        >
          {t('team.points.cancel')}
        </button>
        <button
          type="button"
          disabled={busy || character.statPoints.available === character.statPoints.total}
          onClick={() => void run(() => reset(character.id), t('team.points.resetDone'))}
        >
          {t('team.points.reset')}
        </button>
      </div>
    </>
  );
}
