/**
 * Passifs des objets Uniques (Equipements_RPG_Tour.xlsx, onglet Uniques) : chiffres repris du texte
 * de chaque passif. Ce fichier ne dépend d'aucun autre fichier du moteur (il est lu par les dégâts
 * et les altérations) ; les déclencheurs sont dans uniques.ts.
 * Lecture du texte (décision du 19/10/2026) : « tour » = manche ; « attaque de base » = compétence
 * sans recharge ; toutes les attaques du Tireur sont « à distance ».
 */
import type { Combatant } from './types.ts';

export const UNIQUE = {
  // Guerrier
  willpower: 'GUE-CHA-UNI', // Volonté inflexible
  graniteSkin: 'GUE-ARM-UNI', // Peau de granit
  emberTrail: 'GUE-PAN-UNI', // Sillage de braise
  frostStomp: 'GUE-BOT-UNI', // Piétinement givré
  bloodOath: 'GUE-COL-UNI', // Serment de sang
  corrosiveBite: 'GUE-AN1-UNI', // Morsure corrosive
  soothingTide: 'GUE-AN2-UNI', // Marée apaisante
  conduction: 'GUE-CEI-UNI', // Conduction
  grimHarvest: 'GUE-AR1-UNI', // Moisson funeste
  lastBastion: 'GUE-AR2-UNI', // Dernier rempart
  // Mage
  quickThought: 'MAG-CHA-UNI', // Pensée vive
  frostMantle: 'MAG-ARM-UNI', // Manteau de givre
  risingStorm: 'MAG-PAN-UNI', // Tempête naissante
  risingTide: 'MAG-BOT-UNI', // Marée montante
  cursedGaze: 'MAG-COL-UNI', // Regard maudit
  transmutation: 'MAG-AN1-UNI', // Transmutation
  guardStone: 'MAG-AN2-UNI', // Pierre de garde
  livingFlame: 'MAG-CEI-UNI', // Flamme vive
  arcaneOverload: 'MAG-AR1-UNI', // Surcharge arcanique
  alternation: 'MAG-AR2-UNI', // Alternance
  // Tireur
  piercingGaze: 'TIR-CHA-UNI', // Regard perçant
  protectiveMist: 'TIR-ARM-UNI', // Brume protectrice
  frostTracking: 'TIR-PAN-UNI', // Traque givrée
  lightningStep: 'TIR-BOT-UNI', // Pas d'éclair
  protectiveRoots: 'TIR-COL-UNI', // Racines protectrices
  incendiaryTips: 'TIR-AN1-UNI', // Pointes incendiaires
  lastBreath: 'TIR-AN2-UNI', // Dernier souffle
  corrosiveVials: 'TIR-CEI-UNI', // Fioles corrosives
  arrowRain: 'TIR-AR1-UNI', // Pluie de flèches
  spectralArrows: 'TIR-AR2-UNI', // Flèches spectrales
} as const;

export type UniqueId = (typeof UNIQUE)[keyof typeof UNIQUE];

export const UNIQUE_PASSIVE_RULES = {
  willpower: { resistance: 0.15, rounds: 3 },
  graniteSkin: { physicalReduction: 0.12, hitsNeeded: 3, armor: 0.2, rounds: 2 },
  emberTrail: { chance: 0.25 },
  frostStomp: { chance: 0.3 },
  bloodOath: { lifesteal: 0.05, lowHpLifesteal: 0.1, lowHp: 0.5, maxPerRound: 0.1 },
  soothingTide: { every: 4, heal: 0.03 },
  conduction: { chance: 0.15, share: 0.5 },
  grimHarvest: { heal: 0.08 },
  lastBastion: { below: 0.3, shield: 0.2, rounds: 3 },
  quickThought: { chance: 0.15 },
  frostMantle: { chance: 0.2 },
  risingStorm: { every: 3, power: 0.4 },
  risingTide: { chance: 0.25 },
  cursedGaze: { chance: 0.25 },
  transmutation: { share: 0.1, cap: 0.15, rounds: 2 },
  guardStone: { reduction: 0.12, above: 0.5 },
  livingFlame: { value: 0.1, rounds: 2 },
  arcaneOverload: { charges: 5, bonus: 0.6 },
  alternation: { healing: 0.15, magicDamage: 0.15 },
  protectiveMist: { dodge: 0.05, rounds: 2, maxStacks: 3 },
  lightningStep: { bonus: 0.3, stunChance: 0.3 },
  protectiveRoots: { share: 0.1, cap: 0.1, rounds: 2 },
  incendiaryTips: { share: 0.15, rounds: 2 },
  lastBreath: { dodge: 0.2, rounds: 2 },
  corrosiveVials: { chance: 0.25, value: 0.06, maxStacks: 3 },
  arrowRain: { chance: 0.2, arrows: 2, share: 0.3 },
  spectralArrows: { share: 0.4 },
  /** « Plafond global de réduction de dégâts : 30 % » (Pierre de garde), pour tous les Uniques. */
  maxDamageReduction: 0.3,
} as const;

/** Le combattant porte-t-il cet Unique ? */
export function hasUnique(c: Combatant, id: UniqueId): boolean {
  return c.uniques?.includes(id) ?? false;
}

/**
 * Dégâts reçus × (1 − réduction des Uniques) : Peau de granit (dégâts physiques) et Pierre de garde
 * (au-dessus de la moitié des PV), plafonnées ensemble à 30 %.
 */
export function uniqueDamageTakenFactor(defender: Combatant, physicalShare: number): number {
  const rules = UNIQUE_PASSIVE_RULES;
  let reduction = 0;
  if (hasUnique(defender, UNIQUE.graniteSkin))
    reduction += rules.graniteSkin.physicalReduction * physicalShare;
  if (
    hasUnique(defender, UNIQUE.guardStone) &&
    defender.hp / defender.stats.maxHp > rules.guardStone.above
  )
    reduction += rules.guardStone.reduction;
  return 1 - Math.min(rules.maxDamageReduction, reduction);
}
