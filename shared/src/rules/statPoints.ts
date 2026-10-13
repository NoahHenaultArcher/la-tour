/** Points de statistiques gagnés par niveau et répartis par le joueur (réglages : balance.ts). */
import { ALLOCATABLE_STATS, STAT_POINTS, type AllocatableStat } from '../balance.ts';

export type StatAllocation = Record<AllocatableStat, number>;

export function emptyAllocation(): StatAllocation {
  return Object.fromEntries(ALLOCATABLE_STATS.map((s) => [s, 0])) as StatAllocation;
}

/** Normalise une répartition lue en base (clés inconnues ignorées, valeurs manquantes à 0). */
export function toAllocation(value: unknown): StatAllocation {
  const allocation = emptyAllocation();
  if (value && typeof value === 'object') {
    for (const stat of ALLOCATABLE_STATS) {
      const n = (value as Record<string, unknown>)[stat];
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) allocation[stat] = n;
    }
  }
  return allocation;
}

/** Points gagnés depuis le niveau 1. */
export function totalStatPoints(level: number): number {
  return Math.max(0, level - 1) * STAT_POINTS.perLevel;
}

export function spentStatPoints(allocation: StatAllocation): number {
  return ALLOCATABLE_STATS.reduce((sum, stat) => sum + allocation[stat], 0);
}

export function availableStatPoints(level: number, allocation: StatAllocation): number {
  return totalStatPoints(level) - spentStatPoints(allocation);
}

/** Gain de statistiques apporté par une répartition. */
export function allocationBonus(allocation: StatAllocation): StatAllocation {
  const bonus = emptyAllocation();
  for (const stat of ALLOCATABLE_STATS)
    bonus[stat] = allocation[stat] * STAT_POINTS.valuePerPoint[stat];
  return bonus;
}

/** Ajoute des points à une répartition ; null si le total dépasse les points gagnés. */
export function addStatPoints(
  level: number,
  current: StatAllocation,
  added: Partial<StatAllocation>,
): StatAllocation | null {
  const next = { ...current };
  for (const stat of ALLOCATABLE_STATS) {
    const n = added[stat] ?? 0;
    if (!Number.isInteger(n) || n < 0) return null;
    next[stat] += n;
  }
  return spentStatPoints(next) <= totalStatPoints(level) ? next : null;
}
