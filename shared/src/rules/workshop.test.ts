import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { nextUpgradeCost } from './equipment.ts';
import { createRng } from './random.ts';
import {
  craftCost,
  craftRarityChances,
  itemWorkTier,
  rollCraftRarity,
  workshopMaxTier,
  workshopUpgradeCost,
} from './workshop.ts';

const item = (id: string) => gameData.equipment.catalog.find((c) => c.id === id)!;

describe('Atelier de fabrication', () => {
  it('niveau 1 : paliers 1 et 2 ; chaque niveau suivant ouvre un palier', () => {
    expect(workshopMaxTier(undefined)).toBe(0);
    expect(workshopMaxTier(1)).toBe(2);
    expect(workshopMaxTier(2)).toBe(3);
    expect(workshopMaxTier(3)).toBe(4);
    expect(workshopMaxTier(4)).toBe(5);
    expect(workshopMaxTier(5)).toBe(5);
  });

  it('ces paliers correspondent aux effets écrits dans le classeur', () => {
    const effects = gameData.village.upgrades.filter((u) => u.buildingId === 'atelier_fabrication');
    expect(effects.find((u) => u.targetLevel === 2)!.effect).toContain('palier 3');
    expect(effects.find((u) => u.targetLevel === 4)!.effect).toContain('Palier 5');
    expect(effects.find((u) => u.targetLevel === 5)!.effect).toContain('−10 %');
  });

  it('niveau 5 : −10 % de ressources pour améliorer', () => {
    const sword = item('GUE-AR1-P2-EPI');
    const normal = nextUpgradeCost(gameData.equipment, sword, 10)!;
    expect(workshopUpgradeCost(gameData.equipment, sword, 10, 4)).toEqual(normal);
    expect(workshopUpgradeCost(gameData.equipment, sword, 10, 5)).toEqual({
      resourceId: 'fer',
      quantity: Math.round(normal.quantity * 0.9),
    });
    expect(workshopUpgradeCost(gameData.equipment, sword, 20, 5)).toBeNull();
  });

  it('le palier d’un Unique suit son niveau', () => {
    const helm = item('GUE-CHA-UNI');
    expect(itemWorkTier(gameData.equipment, helm, 0)).toBe(1);
    expect(itemWorkTier(gameData.equipment, helm, 13)).toBe(2);
    expect(itemWorkTier(gameData.equipment, helm, 29)).toBe(3); // +30 max : niveau 31
    expect(itemWorkTier(gameData.equipment, item('MAG-AR2-P4-COM'), 0)).toBe(4);
  });

  it('fabriquer un objet Commun coûte son prix en boutique, payé en unités de son matériau', () => {
    const commons = gameData.equipment.catalog.filter((c) => c.rarity === 'common');
    expect(commons).toHaveLength(150);
    for (const c of commons) {
      const cost = craftCost(gameData, c);
      const price = gameData.shop.equipment.find((e) => e.tier === c.tier)!.prices.common;
      const unit = gameData.shop.resources.find((r) => r.resourceId === c.material)!.unitPrice;
      expect(cost.resourceId, c.id).toBe(c.material);
      expect(cost.quantity * unit, c.id).toBeGreaterThanOrEqual(price);
      expect((cost.quantity - 1) * unit, c.id).toBeLessThan(price);
    }
    // Épée en bois : 536 or ÷ 40 or le bois → 14 bois.
    expect(craftCost(gameData, item('GUE-AR1-P1-COM'))).toEqual({
      resourceId: 'bois',
      quantity: 14,
    });
    expect(() => craftCost(gameData, item('GUE-AR1-P2-EPI'))).toThrow();
  });
});

describe('rareté des objets fabriqués', () => {
  it('Atelier niveau 1 : 70 % Commun … 0,05 % Légendaire, jamais d’Unique', () => {
    const chances = craftRarityChances(1);
    expect(chances.common).toBeCloseTo(0.7, 10);
    expect(chances.rare).toBeCloseTo(0.2, 10);
    expect(chances.superRare).toBeCloseTo(0.07, 10);
    expect(chances.epic).toBeCloseTo(0.025, 10);
    expect(chances.mythic).toBeCloseTo(0.0045, 10);
    expect(chances.legendary).toBeCloseTo(0.0005, 10);
    expect(chances.unique).toBe(0);
  });

  it('chaque niveau d’Atelier au-delà du 1er : +10 % sur les raretés au-dessus du Commun', () => {
    const chances = craftRarityChances(5);
    expect(chances.rare).toBeCloseTo(0.28, 10);
    expect(chances.legendary).toBeCloseTo(0.0007, 10);
    expect(chances.common).toBeCloseTo(0.58, 10);
    const total = Object.values(chances).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('le tirage suit ces chances', () => {
    const rng = createRng(42);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const rarity = rollCraftRarity(rng, 1);
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    expect(counts.common! / 20000).toBeCloseTo(0.7, 1);
    expect(counts.rare! / 20000).toBeCloseTo(0.2, 1);
    expect(counts.unique).toBeUndefined();
  });
});
