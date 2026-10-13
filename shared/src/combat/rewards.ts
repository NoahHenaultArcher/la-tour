/**
 * Récompenses d'un combat : or et XP des monstres vaincus (y compris en cas de défaite :
 * « l'XP et le butin déjà gagnés pendant l'étage sont conservés »).
 * XP de chaque héros = XP du monstre × écart de niveau × part selon le nombre de héros × bonus.
 */
import type { MonstersData } from '../data/schemas.ts';
import { levelGapXpFactor, xpShare } from '../rules/rewards.ts';
import type { CombatState } from './types.ts';

export interface CombatRewards {
  gold: number;
  /** XP gagnée par personnage (identifiant du personnage). */
  xp: Record<string, number>;
}

export function combatRewards(
  data: MonstersData,
  state: CombatState,
  /** Bonus « Or et XP » de la Tour d'amélioration (0,04 = +4 %). */
  goldXpBonus = 0,
): CombatRewards {
  const share = xpShare(state.heroes.length);
  const gold = state.killed.reduce((sum, k) => sum + k.gold, 0);
  const xp: Record<string, number> = {};
  for (const hero of state.heroes) {
    let total = 0;
    for (const k of state.killed)
      total += k.xp * levelGapXpFactor(data, k.level, hero.level) * share;
    xp[hero.refId] = Math.floor(total * (1 + goldXpBonus));
  }
  return { gold: Math.floor(gold * (1 + goldXpBonus)), xp };
}
