/**
 * Simulation d'équilibrage : un héros seul, SANS équipement, avec son kit de départ, en mode auto.
 * Garantit que le début de partie est faisable (étages 1 à 5) et que la tour reste praticable
 * sans équipement jusqu'à l'étage 10 (une défaite garde l'XP gagnée : on retente).
 */
import { describe, expect, it } from 'vitest';
import type { ClassId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { addXp } from '../rules/rewards.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { createCombat, playAutoTurn } from './engine.ts';
import { combatRewards } from './rewards.ts';
import type { CombatState } from './types.ts';

const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];

function fight(classId: ClassId, level: number, floor: number, seed: number): CombatState {
  let { state } = createCombat(gameData, {
    floor,
    heroes: [
      {
        characterId: 'c',
        classId,
        level,
        heritageCount: 0,
        equipment: [],
        deck: starterDeckFor(gameData, classId),
      },
    ],
    tower: {},
    seed,
  });
  while (state.phase === 'heroes') state = playAutoTurn(gameData, state).state;
  return state;
}

function winRate(classId: ClassId, level: number, floor: number, runs = 40): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    if (fight(classId, level, floor, seed).phase === 'victory') wins++;
  }
  return wins / runs;
}

describe('équilibrage sans équipement (kit de départ, mode auto)', () => {
  for (const classId of CLASSES) {
    it(`${classId} : étages 1 à 4 gagnés presque toujours au niveau de l'étage`, () => {
      for (const floor of [1, 2, 3, 4]) {
        expect(winRate(classId, floor, floor), `étage ${floor}`).toBeGreaterThanOrEqual(0.95);
      }
    });

    it(`${classId} : le premier boss (étage 5) est battu le plus souvent dès le niveau 6`, () => {
      expect(winRate(classId, 6, 5)).toBeGreaterThanOrEqual(0.6);
    });

    it(`${classId} : monte jusqu'à l'étage 10 presque sans échec (début adouci)`, () => {
      let hero = { level: 1, xp: 0 };
      let attempts = 0;
      for (let floor = 1; floor <= 10; floor++) {
        let won = false;
        for (let tries = 1; !won; tries++) {
          expect(tries, `étage ${floor}`).toBeLessThanOrEqual(10);
          attempts++;
          const state = fight(classId, hero.level, floor, floor * 100 + tries);
          const xp = combatRewards(gameData.monsters, state).xp.c ?? 0;
          hero = { ...hero, ...addXp(gameData.monsters, hero, xp) };
          won = state.phase === 'victory';
        }
      }
      expect(attempts).toBeLessThanOrEqual(14);
    });
  }
});
