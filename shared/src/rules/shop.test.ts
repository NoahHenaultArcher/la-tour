import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { generateShop, isSoldAtTavern, nextShopRefresh, sellPrice, shopPeriod } from './shop.ts';

const item = (id: string) => gameData.equipment.catalog.find((c) => c.id === id)!;
const shop = (overrides: Partial<Parameters<typeof generateShop>[1]> = {}) =>
  generateShop(gameData, {
    seed: 7,
    ownedClasses: ['warrior'],
    bestFloor: 3,
    tavernLevel: 1,
    ...overrides,
  });

describe('taverne', () => {
  it('se renouvelle toutes les heures', () => {
    const now = new Date('2026-10-13T14:25:00Z');
    expect(shopPeriod(gameData, new Date('2026-10-13T14:59:59Z'))).toBe(shopPeriod(gameData, now));
    expect(shopPeriod(gameData, new Date('2026-10-13T15:00:00Z'))).toBe(
      shopPeriod(gameData, now) + 1,
    );
    expect(nextShopRefresh(gameData, now).toISOString()).toBe('2026-10-13T15:00:00.000Z');
  });

  it('propose 6 objets et 4 lots au niveau 1, plus avec le niveau, avec une remise', () => {
    const level1 = shop({ bestFloor: 30 });
    expect(level1.items).toHaveLength(6);
    expect(level1.lots).toHaveLength(4);
    expect(level1.discount).toBe(0);
    const level9 = shop({ tavernLevel: 9, bestFloor: 30 });
    expect(level9.items).toHaveLength(10);
    expect(level9.lots).toHaveLength(8);
    expect(level9.discount).toBeCloseTo(0.16, 10);
  });

  it('améliorer la taverne ajoute des offres sans changer celles déjà affichées', () => {
    const before = shop({ bestFloor: 30 });
    const after = shop({ bestFloor: 30, tavernLevel: 9 });
    expect(after.items.slice(0, 6).map((o) => o.catalogId)).toEqual(
      before.items.map((o) => o.catalogId),
    );
    expect(after.lots.slice(0, 4).map((o) => o.resourceId)).toEqual(
      before.lots.map((o) => o.resourceId),
    );
  });

  it('vend des objets Commun → Épique des classes possédées, dans les paliers débloqués', () => {
    for (let seed = 0; seed < 50; seed++) {
      const offers = shop({ seed, ownedClasses: ['mage', 'ranger'], bestFloor: 20 });
      for (const offer of offers.items) {
        const info = item(offer.catalogId);
        expect(['mage', 'ranger']).toContain(info.classId);
        expect(isSoldAtTavern(info.rarity)).toBe(true);
        expect(info.tier).toBeLessThanOrEqual(2); // étage 20 : paliers 1 et 2
        const base = gameData.shop.equipment.find((e) => e.tier === info.tier)!.prices;
        expect(offer.price).toBe(base[info.rarity as keyof typeof base]);
      }
    }
  });

  it('au début (Forêt), seulement du Commun et du Rare', () => {
    const rarities = new Set<string>();
    for (let seed = 0; seed < 100; seed++)
      for (const o of shop({ seed }).items) rarities.add(item(o.catalogId).rarity);
    expect([...rarities].sort()).toEqual(['common', 'rare']);
  });

  it('lots de 10 ressources débloquées ; toile, verre et cuivre toujours en vente', () => {
    const offers = shop({ bestFloor: 3 });
    for (const lot of offers.lots) {
      expect(lot.quantity).toBe(10);
      expect(['bois', 'cuir', 'lin']).toContain(lot.resourceId); // seules ressources débloquées à l'étage 3
    }
    expect(offers.lots).toHaveLength(3);
    expect(offers.permanentLots.map((l) => l.resourceId).sort()).toEqual([
      'cuivre',
      'toile',
      'verre',
    ]);
    expect(offers.permanentLots[0]!.price).toBe(400);
  });

  it('vend les classes non possédées : 50 400 or le 2e personnage, 232 400 le 3e', () => {
    expect(shop().characters.map((c) => [c.classId, c.price])).toEqual([
      ['mage', 50_400],
      ['ranger', 50_400],
    ]);
    expect(shop({ ownedClasses: ['warrior', 'mage'] }).characters).toEqual([
      { offerId: 'class-ranger', classId: 'ranger', price: 232_400 },
    ]);
    expect(shop({ ownedClasses: ['warrior', 'mage', 'ranger'] }).characters).toEqual([]);
  });

  it('rachète un objet 20 % de son prix (Mythique et plus : base Épique)', () => {
    expect(sellPrice(gameData, item('GUE-AR1-P1-COM'), 0)).toBe(Math.round(536 * 0.2));
    expect(sellPrice(gameData, item('GUE-AR1-P2-EPI'), 5)).toBe(9979);
    expect(sellPrice(gameData, item('GUE-AR1-P2-LEG'), 0)).toBe(9979);
  });
});
