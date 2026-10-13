import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { starterDeckFor } from '../rules/skills.ts';
import {
  CombatError,
  createCombat,
  playAutoTurn,
  retreatFromHunt,
  winCurrentWave,
} from './engine.ts';

const hero = (level: number) => ({
  characterId: 'c',
  classId: 'ranger' as const,
  level,
  heritageCount: 0,
  equipment: [],
  deck: starterDeckFor(gameData, 'ranger'),
});

const hunt = (zoneFloor: number, level = 30, seed = 1) =>
  createCombat(gameData, {
    floor: zoneFloor,
    mode: 'hunt',
    heroes: [hero(level)],
    tower: {},
    seed,
  });

describe('zones de chasse', () => {
  it('vagues de 3 monstres de la zone, sans le boss, de niveau étage → étage + 10', () => {
    let { state } = hunt(5);
    const regulars = new Set(
      gameData.monsters.monsters
        .filter((m) => m.zoneFloor === 5 && m.rank !== 'boss')
        .map((m) => m.id),
    );
    for (let i = 0; i < 30; i++) state = winCurrentWave(gameData, state).state;
    const spawns = state.waves.flat();
    expect(state.waves.every((w) => w.length === 3)).toBe(true);
    expect(spawns.every((s) => regulars.has(s.monsterId))).toBe(true);
    expect(Math.min(...spawns.map((s) => s.level))).toBe(5);
    expect(Math.max(...spawns.map((s) => s.level))).toBe(15);
  });

  it('les vagues ne s’arrêtent jamais : pas de victoire, on part quand on veut', () => {
    let { state } = hunt(10);
    for (let i = 0; i < 12; i++) state = winCurrentWave(gameData, state).state;
    expect(state.phase).toBe('heroes');
    expect(state.waveIndex).toBe(12);
    expect(state.killed).toHaveLength(36);
    const { state: done, events } = retreatFromHunt(gameData, state);
    expect(done.phase).toBe('retreat');
    expect(events.at(-1)).toEqual({ type: 'end', outcome: 'retreat' });
  });

  it('on ne « quitte » pas un étage de la tour', () => {
    const { state } = createCombat(gameData, { floor: 1, heroes: [hero(10)], tower: {}, seed: 1 });
    expect(() => retreatFromHunt(gameData, state)).toThrow(CombatError);
  });

  it('les PV restent d’une vague à l’autre : un héros trop faible finit par tomber', () => {
    let { state } = hunt(50, 5);
    for (let i = 0; i < 500 && state.phase === 'heroes'; i++)
      state = playAutoTurn(gameData, state).state;
    expect(state.phase).toBe('defeat');
  });

  it('les tannières de dragon n’ont pas de zone de chasse', () => {
    expect(() => hunt(9)).toThrow();
  });
});
