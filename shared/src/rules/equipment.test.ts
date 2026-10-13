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
  it('reproduisent les 930 objets du Catalogue à +0', () => {
    for (const item of data.catalog) {
      expect(itemStats(data, item, 0), item.id).toEqual(item.statsAtZero);
    }
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
    expect(upgradeResource(data, helm, 98)).toBe('adamantite');
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
