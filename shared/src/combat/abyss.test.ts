import { describe, expect, it } from 'vitest';
import { ABYSS, ALPHA, ALPHA_TRAIT_IDS } from '../balance.ts';
import { gameData } from '../data/index.ts';
import {
  abyssDifficulty,
  abyssDragon,
  abyssFloorType,
  abyssMonsterLevel,
  isAbyssUnlocked,
} from '../rules/abyss.ts';
import { rollLoot } from '../rules/loot.ts';
import { createRng } from '../rules/random.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { createCombat, winCurrentWave } from './engine.ts';
import { buildAbyssWaves, createMonsterCombatant } from './setup.ts';

const monster = (id: string) => gameData.monsters.monsters.find((m) => m.id === id)!;

describe('Abysse : étages', () => {
  it("s'ouvre après l'étage 100", () => {
    expect(isAbyssUnlocked(99)).toBe(false);
    expect(isAbyssUnlocked(100)).toBe(true);
  });

  it('boss tous les 5 étages, tanières au hasard ailleurs (jamais sur un multiple de 5)', () => {
    const types = Array.from({ length: 500 }, (_, i) => abyssFloorType(i + 1));
    types.forEach((type, i) => {
      if ((i + 1) % 5 === 0) expect(type).toBe('boss');
      else expect(type).not.toBe('boss');
    });
    const lairs = types.filter((t) => t === 'dragon').length / 400;
    expect(lairs).toBeGreaterThan(ABYSS.dragonChance / 2);
    expect(lairs).toBeLessThan(ABYSS.dragonChance * 2);
    // Toujours le même résultat pour un étage donné.
    expect(abyssFloorType(37)).toBe(abyssFloorType(37));
  });

  it('les monstres montent en niveau et en renfort à chaque étage', () => {
    expect(abyssMonsterLevel(1)).toBe(100 + ABYSS.levelsPerFloor);
    expect(abyssMonsterLevel(20)).toBeGreaterThan(abyssMonsterLevel(10));
    expect(abyssDifficulty(20).hp).toBeGreaterThan(abyssDifficulty(10).hp);
    expect(abyssDifficulty(20).attack).toBeGreaterThan(abyssDifficulty(10).attack);
  });
});

describe('Abysse : vagues', () => {
  const allWaves = (floor: number, seeds = 40) =>
    Array.from({ length: seeds }, (_, seed) => buildAbyssWaves(gameData, floor, createRng(seed)));

  it('étage normal : 3 vagues de 3, monstres de toutes les zones mélangés', () => {
    const floor = Array.from({ length: 50 }, (_, i) => i + 1).find(
      (f) => abyssFloorType(f) === 'normal',
    )!;
    const runs = allWaves(floor);
    for (const waves of runs) {
      expect(waves).toHaveLength(3);
      expect(waves.every((w) => w.length === 3)).toBe(true);
    }
    const spawns = runs.flat(2);
    const zones = new Set(spawns.map((s) => monster(s.monsterId).zoneFloor));
    expect(zones.size).toBeGreaterThan(10);
    expect(spawns.every((s) => !['boss', 'dragon'].includes(monster(s.monsterId).rank))).toBe(true);
    expect(spawns.every((s) => s.level === abyssMonsterLevel(floor))).toBe(true);
  });

  it('étage de boss : 5 vagues, un boss de n’importe quelle zone + 2 escortes', () => {
    const runs = allWaves(10);
    const bossZones = new Set<number>();
    for (const waves of runs) {
      expect(waves).toHaveLength(5);
      const last = waves.at(-1)!;
      expect(last).toHaveLength(3);
      expect(monster(last[0]!.monsterId).rank).toBe('boss');
      bossZones.add(monster(last[0]!.monsterId).zoneFloor);
    }
    expect(bossZones.size).toBeGreaterThan(3);
  });

  it('tanière : le dragon de l’étage, seul, jamais alpha', () => {
    const lair = Array.from({ length: 200 }, (_, i) => i + 1).find(
      (f) => abyssFloorType(f) === 'dragon',
    )!;
    const dragon = abyssDragon(gameData.monsters, lair)!;
    expect(dragon.rank).toBe('dragon');
    for (const waves of allWaves(lair)) {
      expect(waves).toEqual([
        [{ monsterId: dragon.id, level: abyssMonsterLevel(lair), abyssFloor: lair }],
      ]);
    }
  });

  it('environ un monstre sur 20 est alpha, avec un trait', () => {
    const spawns = allWaves(1, 400).flat(2);
    const alphas = spawns.filter((s) => s.alpha);
    const share = alphas.length / spawns.length;
    expect(share).toBeGreaterThan(ALPHA.chance / 2);
    expect(share).toBeLessThan(ALPHA.chance * 2);
    expect(new Set(alphas.map((s) => s.alpha)).size).toBe(ALPHA_TRAIT_IDS.length);
  });
});

describe('Abysse : monstres', () => {
  const id = gameData.monsters.monsters.find((m) => m.rank === 'normal')!.id;

  it('le renfort de l’étage et l’alpha multiplient PV, attaque et récompenses', () => {
    const plain = createMonsterCombatant(gameData, { monsterId: id, level: 110 }, 'm0');
    const abyss = createMonsterCombatant(
      gameData,
      { monsterId: id, level: 110, abyssFloor: 10 },
      'm1',
    );
    const alpha = createMonsterCombatant(
      gameData,
      { monsterId: id, level: 110, abyssFloor: 10, alpha: 'carapace' },
      'm2',
    );
    const factor = abyssDifficulty(10);
    expect(abyss.stats.maxHp).toBeCloseTo(plain.stats.maxHp * factor.hp, -1);
    expect(alpha.stats.maxHp).toBeCloseTo(abyss.stats.maxHp * ALPHA.hpMultiplier, -1);
    expect(alpha.alpha).toBe('carapace');
    expect(alpha.defenseBonus).toBe(ALPHA.carapace);
    expect(alpha.reward!.xp).toBe(abyss.reward!.xp * ALPHA.rewardMultiplier);
    expect(abyss.alpha).toBeNull();
  });

  it('un combat de l’Abysse se gagne vague après vague et note les alphas vaincus', () => {
    let { state } = createCombat(gameData, {
      floor: 10,
      mode: 'abyss',
      heroes: [
        {
          characterId: 'c',
          classId: 'warrior',
          level: 100,
          // Très robuste : « Gagner la vague » ne protège pas des monstres qui jouent en premier.
          heritageCount: 20,
          equipment: [],
          deck: starterDeckFor(gameData, 'warrior'),
        },
      ],
      tower: {},
      seed: 3,
    });
    expect(state.mode).toBe('abyss');
    expect(state.floorType).toBe('boss');
    expect(state.monsters.every((m) => m.level === abyssMonsterLevel(10))).toBe(true);
    const alphas = state.waves.flat().filter((s) => s.alpha).length;
    while (state.phase === 'heroes') state = winCurrentWave(gameData, state).state;
    expect(state.phase).toBe('victory');
    expect(state.killed).toHaveLength(15);
    expect(state.killed.filter((k) => k.alpha)).toHaveLength(alphas);
  });
});

describe('Abysse : butin', () => {
  const normal = gameData.monsters.monsters.find((m) => m.rank === 'normal')!.id;

  it('palier adamantite, butin garanti sur un alpha', () => {
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      const drops = rollLoot(gameData, rng, [{ monsterId: normal, alpha: true }], 1, ['mage'], {
        abyssFloor: 3,
      });
      expect(drops.length).toBeGreaterThan(0);
      for (const d of drops) {
        const item = gameData.equipment.catalog.find((c) => c.id === d.catalogId);
        if (item) expect(item.tier).toBe(5);
      }
    }
  });

  it('les Mythiques et Légendaires sont plus fréquents en profondeur', () => {
    const boss = gameData.monsters.monsters.find((m) => m.rank === 'boss')!.id;
    const high = (abyssFloor: number) => {
      const rng = createRng(7);
      let count = 0;
      for (let i = 0; i < 2000; i++)
        count += rollLoot(gameData, rng, [{ monsterId: boss }], 1, ['ranger'], {
          abyssFloor,
        }).filter((d) => d.rarity === 'mythic' || d.rarity === 'legendary').length;
      return count;
    };
    expect(high(60)).toBeGreaterThan(high(1) * 1.5);
  });

  it("un boss de l'Abysse lâche l'Unique de son biome d'origine", () => {
    const forestBoss = gameData.monsters.monsters.find(
      (m) => m.rank === 'boss' && m.zoneFloor === 5,
    )!;
    const forestUniques = new Set(
      Object.values(gameData.loot.uniquesByBiome.find((u) => u.biome === 'forest')!.uniques),
    );
    const rng = createRng(11);
    const uniques = Array.from({ length: 400 }, () =>
      rollLoot(gameData, rng, [{ monsterId: forestBoss.id }], 1, ['warrior'], { abyssFloor: 5 }),
    )
      .flat()
      .filter((d) => d.rarity === 'unique');
    expect(uniques.length).toBeGreaterThan(0);
    for (const d of uniques) {
      const unique = gameData.equipment.uniques.find((u) => u.id === d.catalogId)!;
      expect(forestUniques.has(unique.name)).toBe(true);
    }
  });
});
