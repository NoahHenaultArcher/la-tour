/**
 * Héros : stats de base dépendant du niveau, PV, bonus d'héritage.
 * Seule l'Initiative de base des classes est définie dans les classeurs (bestiaire, Paramètres §9) ;
 * les autres stats de base par niveau restent à fournir (voir questions en suspens).
 */
import { GAME_RULES, type ClassId } from '../constants.ts';
import type { StatsData } from '../data/schemas.ts';
import { excelRound, levelFactor } from './math.ts';

/** Initiative de base d'une classe : valeur au niveau 100 × facteur de niveau, arrondie. */
export function baseInitiative(data: StatsData, classId: ClassId, level: number): number {
  return excelRound(
    data.character.baseInitiativeAtMaxLevel[classId] *
      levelFactor(level, data.character.levelCurve),
  );
}

/** PV maximum = Vitalité × 10. */
export function maxHp(data: StatsData, vitality: number): number {
  return vitality * data.character.hpPerVitality;
}

/** Multiplicateur de stats après `count` héritages : +25 % par héritage, cumulatif. */
export function heritageMultiplier(count: number): number {
  return 1 + GAME_RULES.heritageStatBonus * count;
}
