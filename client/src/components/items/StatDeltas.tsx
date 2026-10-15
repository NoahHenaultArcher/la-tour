import type { ItemDto } from '@la-tour/shared';
import { compareStats, formatStat, statInfo, statsOf } from '../../game/items.ts';
import { useSession } from '../../stores/session.ts';

/**
 * Gains (vert) et pertes (rouge) de stats si `candidate` remplaçait `reference`
 * (null : l'emplacement est vide, tout est un gain). `wearerId` : héros qui porterait `candidate`
 * (un Unique grandit avec lui).
 */
export function StatDeltas({
  candidate,
  reference,
  wearerId,
}: {
  candidate: ItemDto;
  reference: ItemDto | null;
  wearerId?: string | null;
}) {
  const save = useSession((s) => s.save);
  const deltas = compareStats(
    statsOf(candidate, save, wearerId),
    reference ? statsOf(reference, save) : null,
  );
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
