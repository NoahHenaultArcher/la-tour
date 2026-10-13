/**
 * Simulation d'équilibrage : un héros seul, SANS équipement, en mode auto, avec son kit de départ
 * ou un deck complet (phase 7).
 * Garantit que le début de partie est faisable (étages 1 à 5) et que la tour reste praticable
 * sans équipement jusqu'à l'étage 10 (une défaite garde l'XP gagnée : on retente).
 */
import { describe, expect, it } from 'vitest';
import type { ClassId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { addXp } from '../rules/rewards.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { createCombat, playAutoTurn } from './engine.ts';
import type { HeroSetup } from './setup.ts';
import { combatRewards } from './rewards.ts';
import type { CombatState } from './types.ts';

const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];

function fight(
  classId: ClassId,
  level: number,
  floor: number,
  seed: number,
  deck: HeroSetup['deck'] = starterDeckFor(gameData, classId),
): CombatState {
  let { state } = createCombat(gameData, {
    floor,
    heroes: [
      {
        characterId: 'c',
        classId,
        level,
        heritageCount: 0,
        equipment: [],
        deck,
      },
    ],
    tower: {},
    seed,
  });
  while (state.phase === 'heroes') state = playAutoTurn(gameData, state).state;
  return state;
}

function winRate(
  classId: ClassId,
  level: number,
  floor: number,
  runs = 40,
  deck?: HeroSetup['deck'],
): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    if (fight(classId, level, floor, seed, deck).phase === 'victory') wins++;
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

/** Deck complet (phase 7) : une attaque sans recharge, une de zone, une ultime, deux passifs. */
const FULL_DECKS = Object.fromEntries(
  Object.entries({
    warrior: ['GUE-A01-NEU', 'GUE-A04-NEU', 'GUE-A07-NEU', 'GUE-P02', 'GUE-P04'],
    mage: ['MAG-A01-NEU', 'MAG-A03-NEU', 'MAG-A07-NEU', 'MAG-P01', 'MAG-P02'],
    ranger: ['TIR-A02-NEU', 'TIR-A03-NEU', 'TIR-A07-NEU', 'TIR-P01', 'TIR-P07'],
    // Positions 0 à 2 : actives ; 3 et 4 : passives.
  }).map(([classId, ids]) => [classId, ids.map((skillId, position) => ({ position, skillId }))]),
) as Record<ClassId, HeroSetup['deck']>;

describe('équilibrage avec un deck complet (sans équipement, mode auto)', () => {
  for (const classId of CLASSES) {
    it(`${classId} : le deck aide nettement, sans rendre facile un étage 10 niveaux au-dessus`, () => {
      const deck = FULL_DECKS[classId];
      expect(winRate(classId, 30, 30, 20, deck)).toBeGreaterThanOrEqual(
        winRate(classId, 30, 30, 20),
      );
      expect(winRate(classId, 60, 60, 20, deck)).toBeGreaterThanOrEqual(0.9);
      expect(winRate(classId, 50, 60, 20, deck)).toBeLessThanOrEqual(0.6);
    });
  }
});
