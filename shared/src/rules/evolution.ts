/**
 * Évolutions des classes : au 10e héritage, la classe prend sa 1re évolution, au 20e sa 2e.
 * La 2e évolution garde les bonus de la 1re. L'héritage étant commun au compte, tous les héros
 * d'une sauvegarde évoluent ensemble (y compris ceux recrutés plus tard).
 *
 * | Classe   | 1re évolution                  | 2e évolution                                     |
 * |----------|--------------------------------|--------------------------------------------------|
 * | Mage     | Mage arcaniste : Magie +10 %   | Archimage : 4e active, deux fusions par active   |
 * | Guerrier | Épéiste : Force +10 %, Pén. +15 % | Maître d'armes : 3e emplacement d'arme        |
 * | Tireur   | Arbalétier : 15 % de 2e attaque | Tireur magique : camouflé 3 manches par combat  |
 */
import { CLASS_EVOLUTION } from '../balance.ts';
import type { ClassId } from '../constants.ts';

/** 0 : classe de base, 1 : 1re évolution, 2 : 2e évolution. */
export type EvolutionTier = 0 | 1 | 2;

export const EVOLUTION_IDS = [
  'arcanist',
  'archmage',
  'swordsman',
  'weaponMaster',
  'crossbowman',
  'arcaneArcher',
] as const;
export type EvolutionId = (typeof EVOLUTION_IDS)[number];

/** Évolutions de chaque classe, dans l'ordre des paliers. */
export const CLASS_EVOLUTIONS: Record<ClassId, readonly [EvolutionId, EvolutionId]> = {
  mage: ['arcanist', 'archmage'],
  warrior: ['swordsman', 'weaponMaster'],
  ranger: ['crossbowman', 'arcaneArcher'],
};

/** Palier d'évolution atteint après `heritageCount` héritages. */
export function evolutionTier(heritageCount: number): EvolutionTier {
  const [first, second] = CLASS_EVOLUTION.heritages;
  return heritageCount >= second ? 2 : heritageCount >= first ? 1 : 0;
}

/** Évolution d'une classe à un palier (null : classe de base). */
export function evolutionOf(classId: ClassId, tier: EvolutionTier): EvolutionId | null {
  return tier === 0 ? null : CLASS_EVOLUTIONS[classId][tier - 1]!;
}

/** Héritages qui manquent avant le prochain palier (null : dernière évolution atteinte). */
export function nextEvolution(heritageCount: number) {
  const tier = evolutionTier(heritageCount);
  if (tier === 2) return null;
  const at = CLASS_EVOLUTION.heritages[tier]!;
  return { tier: (tier + 1) as EvolutionTier, heritages: at, missing: at - heritageCount };
}

const reached = (classId: ClassId, tier: EvolutionTier, of: ClassId, needed: EvolutionTier) =>
  classId === of && tier >= needed;

/** Archimage : une 4e compétence active (position 5 du deck). */
export function hasExtraActive(classId: ClassId, tier: EvolutionTier): boolean {
  return reached(classId, tier, 'mage', 2);
}

/** Archimage : deux éléments fusionnés sur chaque active, sans la limite de la Tour d'alchimie. */
export function hasDoubleFusion(classId: ClassId, tier: EvolutionTier): boolean {
  return reached(classId, tier, 'mage', 2);
}

/** Maître d'armes : 3e emplacement d'arme (épée ou bouclier). */
export function hasThirdWeapon(classId: ClassId, tier: EvolutionTier): boolean {
  return reached(classId, tier, 'warrior', 2);
}

/** Arbalétier (et Tireur magique) : chance de porter une attaque une deuxième fois. */
export function secondAttackChance(classId: ClassId, tier: EvolutionTier): number {
  return reached(classId, tier, 'ranger', 1) ? CLASS_EVOLUTION.crossbowmanSecondAttack : 0;
}

/** Tireur magique : manches de camouflage au début de chaque combat. */
export function camouflageRounds(classId: ClassId, tier: EvolutionTier): number {
  return reached(classId, tier, 'ranger', 2) ? CLASS_EVOLUTION.camouflageRounds : 0;
}

/** Bonus de stats permanents : Magie (Mage arcaniste), Force et Pénétration (Épéiste). */
export function evolutionStatBonus(classId: ClassId, tier: EvolutionTier) {
  return {
    magic: reached(classId, tier, 'mage', 1) ? CLASS_EVOLUTION.arcanistMagic : 0,
    strength: reached(classId, tier, 'warrior', 1) ? CLASS_EVOLUTION.swordsmanStrength : 0,
    penetration: reached(classId, tier, 'warrior', 1) ? CLASS_EVOLUTION.swordsmanPenetration : 0,
  };
}
