import { describe, expect, it } from 'vitest';
import { buildFloorWaves } from '../combat/setup.ts';
import { RARITY_IDS, type ClassId, type RarityId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { createRng } from './random.ts';
import {
  biomeOfFloor,
  bossFloorOfUnique,
  catalogItemFor,
  rollLoot,
  uniqueForBossFloor,
} from './loot.ts';

const RUNS = 3000;

/** Objets moyens par étage (tous les monstres vaincus), sur de nombreux tirages. */
function averageItems(floor: number): { average: number; rarities: Record<RarityId, number> } {
  const rng = createRng(floor);
  let total = 0;
  const rarities = Object.fromEntries(RARITY_IDS.map((r) => [r, 0])) as Record<RarityId, number>;
  for (let i = 0; i < RUNS; i++) {
    const killed = buildFloorWaves(gameData, floor, rng).flat();
    const drops = rollLoot(gameData, rng, killed, floor, ['warrior']);
    total += drops.length;
    for (const d of drops) rarities[d.rarity] += 1;
  }
  return { average: total / RUNS, rarities };
}

describe('butin (onglet Butin du bestiaire)', () => {
  it('donne en moyenne le nombre d’objets prévu par l’onglet Étages', () => {
    for (const floor of [1, 5, 9, 37, 60]) {
      const expected = gameData.floors.floors.find((f) => f.floor === floor)!.estimates
        .expectedItems;
      expect(averageItems(floor).average, `étage ${floor}`).toBeCloseTo(expected, 0);
      expect(
        Math.abs(averageItems(floor).average - expected) / expected,
        `étage ${floor}`,
      ).toBeLessThan(0.08);
    }
  });

  it('respecte les raretés du biome (Forêt : seulement Commun et Rare chez les monstres)', () => {
    const { rarities } = averageItems(3);
    expect(
      rarities.superRare + rarities.epic + rarities.mythic + rarities.legendary + rarities.unique,
    ).toBe(0);
    const share = rarities.common / (rarities.common + rarities.rare);
    expect(share).toBeCloseTo(0.8, 1);
  });

  it('un boss lâche toujours le même Unique, quelle que soit la classe tirée', () => {
    const uniques = new Set<string>();
    const rng = createRng(9);
    for (let i = 0; i < 4000; i++) {
      for (const d of rollLoot(gameData, rng, [{ monsterId: 'MON-004' }], 5, ['mage'])) {
        if (d.rarity === 'unique') uniques.add(d.catalogId);
      }
    }
    // Étage 5 (1er boss de la Forêt) : l'Unique du Guerrier.
    expect([...uniques]).toEqual(['GUE-CHA-UNI']);
  });

  it('les monstres des zones de chasse ne lâchent jamais d’Unique', () => {
    const rng = createRng(4);
    const normal = gameData.monsters.monsters.find(
      (m) => m.rank === 'normal' && m.zoneFloor === 100,
    )!;
    for (let i = 0; i < 20000; i++) {
      const drops = rollLoot(gameData, rng, [{ monsterId: normal.id }], 100, ['warrior']);
      expect(drops.some((d) => d.rarity === 'unique')).toBe(false);
    }
  });

  it('un objet tombe dans le matériau du palier de l’étage', () => {
    const rng = createRng(1);
    const tierOf = (floor: number) => {
      const id = catalogItemFor(gameData, 'warrior', 'common', floor, rng);
      return gameData.equipment.catalog.find((c) => c.id === id)!.tier;
    };
    expect(tierOf(14)).toBe(1);
    expect(tierOf(15)).toBe(2);
    expect(tierOf(70)).toBe(5);
  });

  it('chaque étage de boss ou de dragon a son Unique : Guerrier, Mage puis Tireur du biome', () => {
    const name = (floor: number) => uniqueForBossFloor(gameData, floor)?.name;
    expect(name(5)).toBe('Heaume du Roi Déchu');
    expect(name(9)).toBe('Bâton de la Singularité');
    expect(name(10)).toBe('Bague du Dernier Souffle');
    expect(name(95)).toBe('Épée de la Mort');
    expect(uniqueForBossFloor(gameData, 4)).toBeNull();
    // Les 30 Uniques sont tous lâchés, chacun par un seul étage.
    const floors = gameData.equipment.uniques.map((u) => bossFloorOfUnique(gameData, u.id));
    expect(floors.every((f) => f !== null)).toBe(true);
    expect(new Set(floors).size).toBe(30);
    expect(biomeOfFloor(gameData, 55).id).toBe('ocean');
  });

  it('les objets sont pour les classes de l’équipe, réparties au hasard', () => {
    const rng = createRng(3);
    const team: ClassId[] = ['warrior', 'ranger'];
    const classes = new Set<ClassId>();
    for (let i = 0; i < 300; i++) {
      for (const d of rollLoot(gameData, rng, [{ monsterId: 'MON-004' }], 5, team))
        classes.add(d.classId);
    }
    expect([...classes].sort()).toEqual(['ranger', 'warrior']);
    expect(rollLoot(gameData, rng, [{ monsterId: 'MON-004' }], 5, [])).toEqual([]);
  });
});
