import { describe, expect, it } from 'vitest';
import { RARITY_IDS, STAT_IDS, type StatBlock } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { fixtures } from '../test/fixtures.ts';
import {
  clampUpgrade,
  effectiveLevel,
  findProfile,
  findRarity,
  itemPower,
  itemStats,
  maxUpgrade,
  nextUpgradeCost,
  statsAtLevel,
  tierForFloor,
  totalUpgradeQuantity,
  upgradeQuantity,
  upgradeResource,
} from './equipment.ts';
import { levelFactor } from './math.ts';

const data = gameData.equipment;
const itemById = (id: string) => {
  const item = data.catalog.find((c) => c.id === id);
  if (!item) throw new Error(id);
  return item;
};

describe('stats des objets', () => {
  it('reproduisent les 900 objets du Catalogue à +0 (hors Uniques, renforcés : voir plus bas)', () => {
    for (const item of data.catalog.filter((c) => c.rarity !== 'unique')) {
      expect(itemStats(data, item, 0), item.id).toEqual(item.statsAtZero);
    }
  });

  describe('Uniques renforcés (balance.ts, UNIQUE_ITEMS)', () => {
    const uniques = data.catalog.filter((c) => c.rarity === 'unique');
    const power = (item: (typeof uniques)[number], upgrade: number, wearer?: number) =>
      itemPower(data, itemStats(data, item, upgrade, wearer));

    it('légèrement supérieurs à un Légendaire du même emplacement et du même niveau', () => {
      for (const u of uniques) {
        const legendary = data.catalog.find(
          (c) =>
            c.classId === u.classId &&
            c.slot === u.slot &&
            c.rarity === 'legendary' &&
            c.tier === 5,
        )!;
        const ratio = power(u, 0, 100) / itemPower(data, itemStats(data, legendary, 30));
        expect(ratio, u.id).toBeGreaterThan(1.04);
        expect(ratio, u.id).toBeLessThan(1.12);
      }
    });

    it('grandissent avec leur porteur, du niveau de leur biome jusqu’au niveau 100', () => {
      const forest = uniques.find((u) => u.baseLevel === 1)!;
      const demon = uniques.find((u) => u.baseLevel === 91)!;
      expect(power(forest, 0, 85)).toBeGreaterThan(power(forest, 0) * 5);
      expect(itemStats(data, forest, 0, 150)).toEqual(itemStats(data, forest, 0, 100));
      expect(itemStats(data, demon, 0, 20)).toEqual(itemStats(data, demon, 0));
    });

    it('chaque amélioration ajoute des stats, jusqu’à +30 (+1 % par niveau)', () => {
      expect(uniques.every((u) => maxUpgrade(u) === 30)).toBe(true);
      for (const u of uniques) {
        const profile = findProfile(data, u.classId, u.slot);
        const main = STAT_IDS.find((id) => profile.ranks[id] === 1)!;
        for (const wearer of [1, 50, 100]) {
          for (let up = 1; up <= 30; up++) {
            const before = itemStats(data, u, up - 1, wearer);
            const after = itemStats(data, u, up, wearer);
            // La stat principale gagne à chaque niveau ; les autres ne baissent jamais.
            expect(after[main], `${u.id} +${up}`).toBeGreaterThan(before[main]);
            for (const id of STAT_IDS) expect(after[id]).toBeGreaterThanOrEqual(before[id]);
          }
        }
        const ratio = power(u, 30, 100) / power(u, 0, 100);
        expect(ratio, u.id).toBeGreaterThan(1.29);
        expect(ratio, u.id).toBeLessThan(1.5);
      }
      const forest = uniques.find((u) => u.baseLevel === 1)!;
      expect(itemStats(data, forest, 99, 50)).toEqual(itemStats(data, forest, 30, 50));
      expect(nextUpgradeCost(data, forest, 30)).toBeNull();
    });

    it('les autres raretés ignorent le niveau du porteur', () => {
      const epic = data.catalog.find((c) => c.rarity === 'epic')!;
      expect(itemStats(data, epic, 0, 99)).toEqual(itemStats(data, epic, 0));
    });
  });

  it('reproduisent la puissance (pts) du Catalogue', () => {
    for (const item of data.catalog) {
      expect(itemPower(data, item.statsAtZero), item.id).toBe(item.powerAtZero);
    }
  });

  it('reproduisent l’onglet Progression (objet du Calculateur, +0 → max)', () => {
    const { itemId, rows } = fixtures.equipmentProgression;
    const item = itemById(itemId);
    for (const row of rows) {
      expect(effectiveLevel(item, row.upgrade)).toBe(row.effectiveLevel);
      expect(levelFactor(row.effectiveLevel, data.params.levelCurve)).toBeCloseTo(row.factor, 12);
      expect(itemStats(data, item, row.upgrade), `+${row.upgrade}`).toEqual(row.stats);
      if (row.cost !== null) expect(upgradeQuantity(data, item.rarity, row.upgrade)).toBe(row.cost);
      expect(totalUpgradeQuantity(data, item.rarity, 0, row.upgrade)).toBe(row.cumulativeCost);
    }
    expect(rows.at(-1)!.upgrade).toBe(item.maxUpgrade);
  });

  it('reproduisent l’onglet Set complet (somme des 10 slots)', () => {
    const { classId, tier, upgrade, totals } = fixtures.fullSet;
    const tierInfo = data.tiers.find((t) => t.tier === tier)!;
    for (const rarity of RARITY_IDS) {
      const sum = Object.fromEntries(STAT_IDS.map((s) => [s, 0])) as StatBlock;
      const items =
        rarity === 'unique'
          ? // Ligne Unique : calculée au même niveau effectif que les autres, pour comparer.
            data.uniques
              .filter((u) => u.classId === classId)
              .map((u) =>
                statsAtLevel(
                  data,
                  findProfile(data, classId, u.slot),
                  findRarity(data, 'unique'),
                  tierInfo.baseLevel + upgrade,
                ),
              )
          : data.catalog
              .filter((c) => c.classId === classId && c.tier === tier && c.rarity === rarity)
              .map((c) => itemStats(data, c, upgrade));
      expect(items).toHaveLength(10);
      for (const stats of items) for (const s of STAT_IDS) sum[s] += stats[s];
      for (const s of STAT_IDS) expect(sum[s], `${rarity} ${s}`).toBeCloseTo(totals[rarity][s], 9);
    }
  });
});

describe('amélioration des objets', () => {
  it('reproduit l’onglet Amélioration (niveaux 1 à 99, toutes raretés)', () => {
    expect(fixtures.upgradeCosts).toHaveLength(99);
    for (const row of fixtures.upgradeCosts) {
      for (const rarity of RARITY_IDS) {
        expect(upgradeQuantity(data, rarity, row.level), `${rarity} niv. ${row.level}`).toBe(
          row.costs[rarity],
        );
      }
    }
  });

  it('donne le coût du niveau suivant affiché dans le Catalogue', () => {
    for (const item of data.catalog) {
      expect(nextUpgradeCost(data, item, 0), item.id).toEqual({
        resourceId: item.upgradeResourceAtZero,
        quantity: item.upgradeCostToOne,
      });
    }
  });

  it('suit l’exemple du classeur (Épée en bois Commune : 3, 53 puis 119 bois)', () => {
    const sword = data.catalog.find((c) => c.name === 'Épée en bois' && c.rarity === 'common')!;
    expect(nextUpgradeCost(data, sword, 0)).toEqual({ resourceId: 'bois', quantity: 3 });
    expect(nextUpgradeCost(data, sword, 9)).toEqual({ resourceId: 'bois', quantity: 53 });
    expect(nextUpgradeCost(data, sword, 18)).toEqual({ resourceId: 'bois', quantity: 119 });
    expect(nextUpgradeCost(data, sword, 19)).toBeNull();
  });

  it('plafonne l’amélioration au maximum du palier', () => {
    const sword = data.catalog.find((c) => c.name === 'Épée en bois' && c.rarity === 'common')!;
    expect(sword.maxUpgrade).toBe(19);
    expect(clampUpgrade(sword, 50)).toBe(19);
    expect(clampUpgrade(sword, -3)).toBe(0);
    expect(effectiveLevel(sword, 50)).toBe(20);
  });

  it('fait évoluer la ressource d’un Unique avec son niveau (pas de matériau propre)', () => {
    const helm = itemById('GUE-CHA-UNI');
    expect(helm.material).toBeNull();
    expect(upgradeResource(data, helm, 0)).toBe('cuir');
    expect(upgradeResource(data, helm, 13)).toBe('fer'); // niveau 15 visé → palier 2
    expect(upgradeResource(data, helm, 29)).toBe('acier'); // +30 : niveau 31 → palier 3
    expect(upgradeResource(data, itemById('GUE-AR1-UNI'), 0)).toBe('adamantite');
  });
});

describe('palier du butin selon l’étage', () => {
  it('bois 1–14, fer 15–29, acier 30–49, mithril 50–69, adamantite 70+', () => {
    const expected: [number, number][] = [
      [1, 1],
      [14, 1],
      [15, 2],
      [29, 2],
      [30, 3],
      [49, 3],
      [50, 4],
      [69, 4],
      [70, 5],
      [100, 5],
    ];
    for (const [floor, tier] of expected)
      expect(tierForFloor(data, floor), `étage ${floor}`).toBe(tier);
  });
});
