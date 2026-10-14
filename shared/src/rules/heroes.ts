/**
 * Statistiques d'un héros : base de la classe (courbe de niveau) + équipement, puis bonus d'héritage.
 * Les valeurs de base sont des choix d'équilibrage (shared/src/balance.ts) ; l'Initiative de base
 * vient du bestiaire (Paramètres §9).
 */
import {
  HERO_BASE_EQUIPMENT_STATS,
  HERO_BASE_STATS_AT_MAX_LEVEL,
  HERO_STATUS_RESISTANCE,
  lerpByLevel,
} from '../balance.ts';
import { STAT_IDS, type ClassId, type StatBlock, type StatId } from '../constants.ts';
import type { StatsData } from '../data/schemas.ts';
import { baseInitiative, heritageMultiplier } from './character.ts';
import { excelRound, levelFactor } from './math.ts';
import { allocationBonus, type StatAllocation } from './statPoints.ts';

/** Statistiques principales : celles que l'héritage augmente. */
export const MAIN_STAT_IDS: readonly StatId[] = [
  'vitality',
  'strength',
  'resistance',
  'magic',
  'agility',
  'initiative',
];

export function emptyStats(): StatBlock {
  return Object.fromEntries(STAT_IDS.map((id) => [id, 0])) as StatBlock;
}

/** Stats d'un héros nu à un niveau donné. */
export function heroBaseStats(data: StatsData, classId: ClassId, level: number): StatBlock {
  const factor = levelFactor(level, data.character.levelCurve);
  const base = HERO_BASE_STATS_AT_MAX_LEVEL[classId];
  return {
    ...emptyStats(),
    vitality: excelRound(base.vitality * factor),
    strength: excelRound(base.strength * factor),
    resistance: excelRound(base.resistance * factor),
    magic: excelRound(base.magic * factor),
    agility: excelRound(base.agility * factor),
    initiative: baseInitiative(data, classId, level),
    ...HERO_BASE_EQUIPMENT_STATS,
    statusResistance: lerpByLevel(
      level,
      HERO_STATUS_RESISTANCE.atLevel1,
      HERO_STATUS_RESISTANCE.atLevel100,
    ),
  };
}

export interface HeroStatsInput {
  classId: ClassId;
  level: number;
  heritageCount: number;
  /** Stats des objets équipés. */
  equipment: StatBlock[];
  /** Points de statistiques répartis par le joueur. */
  allocation?: StatAllocation;
}

/** Stats finales hors combat : base + points répartis + équipement, stats principales × héritage. */
export function heroStats(data: StatsData, input: HeroStatsInput): StatBlock {
  const stats = heroBaseStats(data, input.classId, input.level);
  if (input.allocation) {
    for (const [stat, value] of Object.entries(allocationBonus(input.allocation))) {
      stats[stat as keyof StatBlock] += value;
    }
  }
  for (const item of input.equipment) for (const id of STAT_IDS) stats[id] += item[id];
  const heritage = heritageMultiplier(input.heritageCount);
  for (const id of MAIN_STAT_IDS) stats[id] = excelRound(stats[id] * heritage);
  return stats;
}

/** Stat d'attaque de la classe (Force pour Guerrier et Tireur, Magie pour le Mage). */
export function classAttackStat(classId: ClassId): 'strength' | 'magic' {
  return classId === 'mage' ? 'magic' : 'strength';
}
