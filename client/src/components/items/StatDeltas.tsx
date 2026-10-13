import type { ItemDto } from '@la-tour/shared';
import { compareStats, formatStat, statInfo, statsOf } from '../../game/items.ts';

/**
 * Gains (vert) et pertes (rouge) de stats si `candidate` remplaçait `reference`
 * (null : l'emplacement est vide, tout est un gain).
 */
export function StatDeltas({
  candidate,
  reference,
}: {
  candidate: ItemDto;
  reference: ItemDto | null;
}) {
  const deltas = compareStats(statsOf(candidate), reference ? statsOf(reference) : null);
  if (deltas.length === 0) return null;
  return (
    <span className="stat-deltas">
      {deltas.map(({ id, delta }) => (
        <span key={id} className={delta > 0 ? 'better' : 'worse'}>
          {statInfo(id).name} {formatStat(id, delta, true)}
        </span>
      ))}
    </span>
  );
}
