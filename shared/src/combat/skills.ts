/**
 * Compétences en combat : effet complet d'une compétence (base + élément, ou base + fusion)
 * et passifs d'un héros. Les effets eux-mêmes sont décrits dans effects.ts.
 */
import type { ElementId } from '../constants.ts';
import {
  ATTACK_EFFECTS,
  ELEMENT_ATTACK_EFFECTS,
  FUSION_EFFECTS,
  PASSIVE_EFFECTS,
  SUPPORT_EFFECTS,
  fusionKey,
  type AttackEffect,
  type PassiveEffect,
} from './effects.ts';
import type { CombatData } from './types.ts';

export type CatalogSkill = CombatData['skills']['catalog'][number];

export function skillById(data: CombatData, skillId: string): CatalogSkill {
  const skill = data.skills.catalog.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Compétence inconnue : ${skillId}`);
  return skill;
}

/** Une compétence qui frappe : les attaques, et les soutiens qui ont une puissance (Coup de bouclier…). */
export function dealsDamage(skill: CatalogSkill): boolean {
  return skill.family === 'attack' || (skill.family === 'support' && skill.power > 0);
}

/** Effet propre d'une compétence qui frappe (sans l'élément). */
export function baseAttackEffect(skill: CatalogSkill): AttackEffect {
  return (
    ATTACK_EFFECTS[skill.baseId] ??
    (skill.family === 'support' ? SUPPORT_EFFECTS[skill.baseId]?.attack : undefined) ??
    {}
  );
}

/**
 * Effet de l'élément d'une attaque : celui de son élément, ou celui de la fusion s'il y en a une
 * (la fusion remplace l'effet simple). Les soutiens ont leur propre effet d'élément.
 */
export function elementalAttackEffect(
  skill: CatalogSkill,
  fusion: ElementId | null | undefined,
): AttackEffect {
  if (skill.family !== 'attack') return {};
  if (fusion) return FUSION_EFFECTS[fusionKey(skill.element, fusion)] ?? {};
  return ELEMENT_ATTACK_EFFECTS[skill.element];
}

const ADDITIVE = [
  'armorIgnore',
  'resistanceIgnore',
  'bonusCrit',
  'damageBonus',
  'alterationChanceBonus',
  'bonusVsAltered',
  'lifesteal',
  'shieldFromDamage',
  'selfHeal',
  'selfShield',
  'cleanseSelf',
  'dispel',
] as const;

/** Combine deux effets : valeurs additionnées, drapeaux cumulés, altérations mises bout à bout. */
export function mergeEffects(a: AttackEffect, b: AttackEffect): AttackEffect {
  const merged: AttackEffect = { ...a, ...b };
  for (const key of ADDITIVE) {
    const sum = (a[key] ?? 0) + (b[key] ?? 0);
    if (sum) merged[key] = sum;
  }
  merged.neverMiss = a.neverMiss || b.neverMiss;
  merged.guaranteedCrit = a.guaranteedCrit || b.guaranteedCrit;
  merged.ignoreElement = a.ignoreElement || b.ignoreElement;
  merged.destroyShield = a.destroyShield || b.destroyShield;
  merged.guaranteedOnPrimary = a.guaranteedOnPrimary || b.guaranteedOnPrimary;
  merged.hits = Math.max(a.hits ?? 1, b.hits ?? 1);
  // Un seul rebond : celui qui touche le plus (traversée du Tir perçant ou rebond de l'élément).
  const reach = (e: AttackEffect) =>
    e.extraTargets ? e.extraTargets.count * e.extraTargets.share : 0;
  merged.extraTargets = reach(b) >= reach(a) ? (b.extraTargets ?? a.extraTargets) : a.extraTargets;
  merged.alterations = [...(a.alterations ?? []), ...(b.alterations ?? [])];
  merged.preAlterations = [...(a.preAlterations ?? []), ...(b.preAlterations ?? [])];
  merged.deathSpread = [...(a.deathSpread ?? []), ...(b.deathSpread ?? [])];
  return merged;
}

/** Effet complet d'une compétence qui frappe (avec son élément ou sa fusion). */
export function attackEffectOf(
  skill: CatalogSkill,
  fusion: ElementId | null | undefined,
): AttackEffect {
  return mergeEffects(baseAttackEffect(skill), elementalAttackEffect(skill, fusion));
}

/** Passifs d'un héros (identifiants du catalogue → effets). */
export function passiveEffectsOf(data: CombatData, passives: readonly string[]): PassiveEffect[] {
  return passives
    .map((id) => PASSIVE_EFFECTS[skillById(data, id).baseId])
    .filter((effect): effect is PassiveEffect => effect !== undefined);
}

/** Somme d'une valeur numérique des passifs. */
export function passiveSum(
  passives: readonly PassiveEffect[],
  pick: (effect: PassiveEffect) => number | undefined,
): number {
  return passives.reduce((sum, effect) => sum + (pick(effect) ?? 0), 0);
}
