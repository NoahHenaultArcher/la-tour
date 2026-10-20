/**
 * Effets de combat des évolutions de classes (rules/evolution.ts) : camouflage du Tireur magique.
 * Les bonus de stats passent par heroStats, la 2e attaque de l'Arbalétier par useHeroSkill.
 */
import { camouflageRounds } from '../rules/evolution.ts';
import type { CombatState, Combatant } from './types.ts';

/**
 * Tireur magique : pendant les premières manches du combat (pas de chaque vague), les monstres
 * ne peuvent pas le viser, attaques de zone comprises.
 */
export function isCamouflaged(state: Pick<CombatState, 'round'>, c: Combatant): boolean {
  if (c.side !== 'hero' || !c.classId) return false;
  const rounds = camouflageRounds(c.classId, c.evolution ?? 0);
  return rounds > 0 && state.round <= rounds;
}

/** Héros que les monstres peuvent viser (vivants ou non : les appelants filtrent). */
export function targetableHeroes(state: CombatState): Combatant[] {
  return state.heroes.filter((h) => !isCamouflaged(state, h));
}
