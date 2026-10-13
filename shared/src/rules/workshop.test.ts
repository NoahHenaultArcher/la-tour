import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { nextUpgradeCost } from './equipment.ts';
import { craftCost, itemWorkTier, workshopMaxTier, workshopUpgradeCost } from './workshop.ts';

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
    expect(itemWorkTier(gameData.equipment, helm, 98)).toBe(5);
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
