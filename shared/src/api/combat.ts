import { z } from 'zod';
import { normalizeCombatState } from '../combat/engine.ts';
import type { CombatEvent, CombatState } from '../combat/types.ts';
import type { ElementId } from '../constants.ts';
import type { SaveDto } from './save.ts';

export const startCombatBodySchema = z.strictObject({
  floor: z.int().min(1).max(100),
});
export type StartCombatBody = z.infer<typeof startCombatBodySchema>;

/** Intention du joueur : « tel héros lance telle compétence sur telle cible ». */
export const combatActionBodySchema = z.strictObject({
  heroId: z.string().min(1).max(16),
  skillId: z.string().min(1).max(32),
  targetId: z.string().min(1).max(16).optional(),
});
export type CombatActionBody = z.infer<typeof combatActionBodySchema>;

/** Ce que le client voit du combat : tout sauf la graine aléatoire et les vagues à venir. */
export type CombatView = Omit<CombatState, 'rng' | 'waves' | 'spawned'> & { waveCount: number };

export function toCombatView(state: CombatState): CombatView {
  const { rng: _rng, waves, spawned: _spawned, ...visible } = normalizeCombatState(state);
  return { ...visible, waveCount: waves.length };
}

export const startHuntBodySchema = z.strictObject({
  /** Étage de la zone de chasse (5, 10, 15…). */
  zoneFloor: z.int().min(1).max(100),
});
export type StartHuntBody = z.infer<typeof startHuntBodySchema>;

export interface CombatOutcome {
  /** « retreat » : le joueur a quitté une zone de chasse (gains conservés). */
  result: 'victory' | 'defeat' | 'retreat';
  mode: 'tower' | 'hunt';
  floor: number;
  gold: number;
  /** XP gagnée par personnage. */
  xp: Record<string, number>;
  levelUps: { characterId: string; from: number; to: number }[];
  /** Vrai si l'étage courant a été validé (progression). */
  floorCleared: boolean;
  unlocked: { elements: ElementId[]; buildings: string[]; huntingZones: string[] };
  /** Objets obtenus (ajoutés à l'inventaire). */
  loot: { itemId: string; catalogId: string }[];
  save: SaveDto;
}

export interface CombatResponse {
  combat: CombatView | null;
  /** Événements produits par la requête, dans l'ordre (animations et journal). */
  events: CombatEvent[];
  outcome: CombatOutcome | null;
}
