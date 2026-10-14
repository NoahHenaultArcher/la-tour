import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import {
  buildingProduction,
  buildingUpgradeCost,
  canAfford,
  computeIdleProduction,
  huntingMinutesForGold,
  nextBuildingUpgrade,
  productionPerHour,
  tavernOffers,
  upgradeShortfall,
  upgradeTowerCost,
  villageIdleSettings,
  warehouseCapacity,
} from './village.ts';

const village = gameData.village;
const HOUR = 3_600_000;

describe('village complet', () => {
  const start = { taverne: 1, entrepot: 1, scierie: 1, champs: 1, terrain_de_chasse: 1, tour: 1 };

  it('additionne la production des bâtiments construits', () => {
    expect(villageIdleSettings(village, start)).toEqual({
      ratesPerHour: { bois: 60, lin: 60, cuir: 60 },
      capacity: 1000,
      maxHours: 8,
      productionBonus: 0,
    });
    const withMine = villageIdleSettings(village, { ...start, scierie: 6, mine: 1, entrepot: 3 });
    expect(withMine.ratesPerHour).toMatchObject({ bois: 106, chene: 90, charbon: 90, fer: 90 });
    expect(withMine.capacity).toBe(5200);
  });

  it('applique les branches de la Tour d’amélioration (production, durée hors ligne)', () => {
    const settings = villageIdleSettings(village, start, { production: 2, offlineDuration: 3 });
    expect(settings.productionBonus).toBeCloseTo(0.1, 12);
    expect(settings.maxHours).toBe(11);
  });

  it('donne la prochaine amélioration et son effet, ou rien au maximum', () => {
    expect(nextBuildingUpgrade(village, 'scierie', 5)).toMatchObject({
      cost: { targetLevel: 6, requiredFloor: 15, material: 'fer' },
      effect: expect.stringContaining('chêne'),
    });
    expect(nextBuildingUpgrade(village, 'scierie', 15)).toBeNull();
    expect(nextBuildingUpgrade(village, 'tour', 1)).toBeNull();
  });

  it('détaille ce qui manque pour améliorer', () => {
    const cost = buildingUpgradeCost(village, 'scierie', 2); // 500 or, 37 bois, étage 0
    const poor = upgradeShortfall(cost, { gold: 100, resources: { bois: 40 }, floorCleared: 0 });
    expect(poor).toEqual({ floor: false, gold: 400, material: 0, coal: 0 });
    expect(canAfford(poor)).toBe(false);
    const rich = upgradeShortfall(cost, { gold: 500, resources: { bois: 37 }, floorCleared: 0 });
    expect(canAfford(rich)).toBe(true);
    const iron = buildingUpgradeCost(village, 'scierie', 6);
    expect(
      upgradeShortfall(iron, { gold: 1e9, resources: { fer: 1e6, charbon: 1e6 }, floorCleared: 14 })
        .floor,
    ).toBe(true);
  });
});

describe('production par heure (onglet Production)', () => {
  it('reproduit chaque ressource à chaque niveau (1 à 25)', () => {
    for (const row of village.production) {
      expect(village.params.baseProductionByTier[row.tier - 1]).toBe(row.baseProductionPerHour);
      row.perLevel.forEach((expected, index) => {
        expect(
          productionPerHour(village, row, index + 1),
          `${row.resourceId} niv. ${index + 1}`,
        ).toBe(expected);
      });
    }
  });

  it('débloque la ressource suivante à certains niveaux (Scierie niv. 6 : chêne et frêne)', () => {
    expect(Object.keys(buildingProduction(village, 'scierie', 5))).toEqual(['bois']);
    expect(buildingProduction(village, 'scierie', 6)).toEqual({ bois: 106, chene: 90, frene: 90 });
  });
});

describe('améliorations des bâtiments (onglet Améliorations)', () => {
  // Écarts voulus avec le classeur : le niveau qui débloque un métal se paie avec le métal précédent.
  const MATERIAL_OVERRIDES: Record<string, string> = {
    'mine niv. 6': 'fer',
    'mine niv. 11': 'acier',
    'mine niv. 16': 'mithril',
  };

  it('reproduit étage requis, or, matériau, quantité et charbon des 117 améliorations', () => {
    for (const row of village.upgrades) {
      const where = `${row.buildingId} niv. ${row.targetLevel}`;
      expect(buildingUpgradeCost(village, row.buildingId, row.targetLevel), where).toEqual({
        targetLevel: row.targetLevel,
        requiredFloor: row.requiredFloor,
        gold: row.gold,
        material: MATERIAL_OVERRIDES[where] ?? row.material,
        quantity: row.quantity,
        coal: row.coal,
      });
      expect(huntingMinutesForGold(village, row.gold, row.requiredFloor), where).toBe(
        row.huntingMinutes,
      );
    }
  });

  it('ne demande jamais une ressource que le village ne produit pas encore', () => {
    const tavernOnly = new Set(
      gameData.resources.resources.filter((r) => r.source === 'taverne').map((r) => r.id),
    );
    for (const row of village.upgrades) {
      const where = `${row.buildingId} niv. ${row.targetLevel}`;
      const cost = buildingUpgradeCost(village, row.buildingId, row.targetLevel);
      const needs = [cost.material, ...(cost.coal > 0 ? ['charbon'] : [])];
      for (const resourceId of needs) {
        // Produite à un étage déjà atteint, par un autre bâtiment ou par un niveau inférieur de celui-ci.
        const produced = village.production.some(
          (p) =>
            p.resourceId === resourceId &&
            p.requiredFloor <= cost.requiredFloor &&
            !(p.buildingId === row.buildingId && p.requiredBuildingLevel >= row.targetLevel),
        );
        expect(produced || tavernOnly.has(resourceId), `${where} : ${resourceId}`).toBe(true);
      }
    }
  });

  it('tient dans l’entrepôt atteignable à l’étage requis', () => {
    const warehouse = village.upgrades.filter((u) => u.buildingId === 'entrepot');
    for (const row of village.upgrades) {
      const cost = buildingUpgradeCost(village, row.buildingId, row.targetLevel);
      const level =
        row.buildingId === 'entrepot'
          ? row.targetLevel - 1
          : Math.max(
              1,
              ...warehouse
                .filter((u) => u.requiredFloor <= cost.requiredFloor)
                .map((u) => u.targetLevel),
            );
      const capacity = warehouseCapacity(village, level);
      const where = `${row.buildingId} niv. ${row.targetLevel}`;
      expect(cost.quantity, where).toBeLessThanOrEqual(capacity);
      expect(cost.coal, where).toBeLessThanOrEqual(capacity);
    }
  });

  it('refuse un niveau hors limites', () => {
    expect(() => buildingUpgradeCost(village, 'taverne', 11)).toThrow();
    expect(() => buildingUpgradeCost(village, 'taverne', 1)).toThrow();
    expect(() => buildingUpgradeCost(village, 'tour', 2)).toThrow();
  });

  it('donne la capacité de l’entrepôt affichée dans l’effet de chaque niveau', () => {
    expect(warehouseCapacity(village, 1)).toBe(1000);
    for (const row of village.upgrades.filter((u) => u.buildingId === 'entrepot')) {
      const shown = Number(/Capacité : (\d+)/.exec(row.effect)![1]);
      expect(warehouseCapacity(village, row.targetLevel), `niv. ${row.targetLevel}`).toBe(shown);
    }
  });

  it('donne les offres et la remise de la taverne affichées dans l’effet de chaque niveau', () => {
    expect(tavernOffers(village, 1)).toEqual({ items: 6, resourceLots: 4, discount: 0 });
    for (const row of village.upgrades.filter((u) => u.buildingId === 'taverne')) {
      const [, items, lots, discount] =
        /Objets proposés : (\d+) · lots : (\d+) · remise : (\d+) %/.exec(row.effect)!;
      expect(tavernOffers(village, row.targetLevel), `niv. ${row.targetLevel}`).toEqual({
        items: Number(items),
        resourceLots: Number(lots),
        discount: Number(discount) / 100,
      });
    }
  });
});

describe('Tour d’amélioration', () => {
  it('reproduit le coût des 20 niveaux', () => {
    for (const row of village.upgradeTower.levels) {
      expect(upgradeTowerCost(village, row.level), `niv. ${row.level}`).toEqual({
        gold: row.gold,
        ether: row.ether,
        branchResource: row.branchResource,
      });
      expect(huntingMinutesForGold(village, row.gold, 100)).toBe(row.huntingMinutes);
    }
  });
});

describe('production idle', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const at = (hours: number) => new Date(start.getTime() + hours * HOUR);
  const base = {
    lastCollectedAt: start,
    ratesPerHour: { bois: 60 },
    stocks: { bois: { amount: 0, fraction: 0 } },
    capacity: 1000,
    maxHours: village.params.maxOfflineHours,
  };

  it('produit en continu selon le temps écoulé', () => {
    const result = computeIdleProduction({ ...base, now: at(2) });
    expect(result.hours).toBe(2);
    expect(result.produced).toEqual({ bois: 120 });
  });

  it('s’arrête après 8 heures', () => {
    expect(village.params.maxOfflineHours).toBe(8);
    const result = computeIdleProduction({ ...base, now: at(30) });
    expect(result.hours).toBe(8);
    expect(result.produced.bois).toBe(480);
  });

  it('est plafonnée par l’entrepôt sans jamais réduire un stock déjà au-dessus', () => {
    const full = computeIdleProduction({
      ...base,
      now: at(8),
      stocks: { bois: { amount: 990, fraction: 0 } },
    });
    expect(full.stocks.bois).toEqual({ amount: 1000, fraction: 0 });
    const above = computeIdleProduction({
      ...base,
      now: at(8),
      stocks: { bois: { amount: 1500, fraction: 0.4 } },
    });
    expect(above.stocks.bois).toEqual({ amount: 1500, fraction: 0 });
    expect(above.produced.bois).toBe(0);
  });

  it('conserve les fractions entre deux collectes rapprochées', () => {
    // 60/h = 1 unité par minute : deux collectes de 30 s donnent 1 unité au total.
    const first = computeIdleProduction({ ...base, now: new Date(start.getTime() + 30_000) });
    expect(first.produced.bois).toBe(0);
    const second = computeIdleProduction({
      ...base,
      lastCollectedAt: new Date(start.getTime() + 30_000),
      now: new Date(start.getTime() + 60_000),
      stocks: first.stocks,
    });
    expect(second.produced.bois).toBe(1);
  });

  it('applique le bonus de production et ignore une horloge qui recule', () => {
    expect(computeIdleProduction({ ...base, now: at(1), productionBonus: 0.5 }).produced.bois).toBe(
      90,
    );
    expect(computeIdleProduction({ ...base, now: at(-1) }).produced.bois).toBe(0);
  });

  it('allonge la durée avec la branche « Durée hors ligne » (+1 h par niveau)', () => {
    const branch = village.upgradeTower.branches.find((b) => b.id === 'offlineDuration')!;
    const result = computeIdleProduction({
      ...base,
      now: at(30),
      maxHours: 8 + branch.bonusPerLevel * 2,
    });
    expect(result.hours).toBe(10);
  });
});
