/**
 * Effets mécaniques des compétences. Les classeurs décrivent les effets en texte libre :
 * on les traduit ici en règles. Phase 4 : kit de départ des 3 classes (les autres compétences
 * infligent leurs dégâts de base ; leurs effets propres arrivent avec les decks en phase 7).
 */
import { COMBAT_RULES } from '../balance.ts';
import type { ElementId } from '../constants.ts';
import type { CombatData } from './types.ts';

export interface ActiveEffect {
  /** Part de l'Armure ignorée (« Perce la garde : ignore 20 % de l'Armure »). */
  armorIgnore?: number;
  /** Part de la Résistance ignorée. */
  resistanceIgnore?: number;
  /** Ne rate jamais. */
  neverMiss?: boolean;
  /** Chance de critique en plus. */
  bonusCrit?: number;
}

export interface PassiveEffect {
  /** Stat multipliée par (1 + valeur). */
  multiply?: Partial<Record<'resistance' | 'magic' | 'strength', number>>;
  /** Stat augmentée de la valeur. */
  add?: Partial<Record<'critChance' | 'critDamage' | 'penetration', number>>;
}

/** Effets propres des compétences actives, par compétence de base. */
export const ACTIVE_EFFECTS: Record<string, ActiveEffect> = {
  'GUE-A01': {}, // Frappe rapide : coup simple et fiable.
  'GUE-A02': { armorIgnore: 0.2 }, // Coup d'estoc : ignore 20 % de l'Armure.
  'MAG-A01': {}, // Boule arcanique : projectile fiable.
  'MAG-A02': { resistanceIgnore: 0.15 }, // Lance arcanique : ignore 15 % de la Résistance.
  'TIR-A01': {}, // Tir rapide : tir fiable.
  'TIR-A02': { neverMiss: true, bonusCrit: 0.2 }, // Tir précis : ne rate jamais, +20 % de critique.
};

/** Effets des passifs, par compétence de base. */
export const PASSIVE_EFFECTS: Record<string, PassiveEffect> = {
  'GUE-P01': { multiply: { resistance: 0.08 } }, // Peau dure : +8 % de Résistance.
  'MAG-P01': { multiply: { magic: 0.08 } }, // Concentration arcanique : +8 % de Magie.
  'TIR-P01': { add: { critChance: 0.05 } }, // Œil vif : +5 % de chance de critique.
};

export function skillById(data: CombatData, skillId: string) {
  const skill = data.skills.catalog.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Compétence inconnue : ${skillId}`);
  return skill;
}

export interface ResolvedAttack {
  power: number;
  element: ElementId;
  area: boolean;
  armorIgnore: number;
  resistanceIgnore: number;
  neverMiss: boolean;
  bonusCrit: number;
}

/** Paramètres d'attaque d'une compétence active (effet propre + effet de l'élément). */
export function resolveAttack(data: CombatData, skillId: string): ResolvedAttack {
  const skill = skillById(data, skillId);
  const effect = ACTIVE_EFFECTS[skill.baseId] ?? {};
  const neutralIgnore = skill.element === 'neutral' ? COMBAT_RULES.neutralResistanceIgnore : 0;
  return {
    power: skill.power,
    element: skill.element,
    area: skill.target === 'area',
    armorIgnore: effect.armorIgnore ?? 0,
    resistanceIgnore: (effect.resistanceIgnore ?? 0) + neutralIgnore,
    neverMiss: effect.neverMiss ?? false,
    bonusCrit: effect.bonusCrit ?? 0,
  };
}
