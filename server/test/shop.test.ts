import { sellPrice, type SaveDto, type ShopDto } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('taverne', () => {
  let ctx: TestContext;
  let cookie: string;
  let saveId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    // Admin avec un Mage niveau 1.
    cookie = await registerAdmin(ctx);
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
  });

  const post = (url: string, payload: object = {}) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const getShop = async (): Promise<ShopDto> =>
    (await ctx.app.inject({ method: 'GET', url: '/api/shop', headers: { cookie } })).json();
  const setGold = (gold: number) =>
    ctx.prisma.save.update({ where: { id: saveId }, data: { gold: BigInt(gold) } });
  const buy = (offerId: string) => post('/api/shop/buy', { offerId });

  it('assortiment : objets Commun à Épique, lots, ressources de taverne, classes non possédées', async () => {
    const shop = await getShop();
    expect(shop.items).toHaveLength(6);
    // Au tout début, seules trois ressources sont en vente (bois, cuir, lin).
    expect(shop.lots.map((l) => l.resourceId).sort()).toEqual(['bois', 'cuir', 'lin']);
    expect(shop.permanentLots.map((l) => l.resourceId).sort()).toEqual([
      'cuivre',
      'toile',
      'verre',
    ]);
    expect(shop.characters.map((c) => c.classId).sort()).toEqual(['ranger', 'warrior']);
    for (const offer of shop.items) {
      const item = gameData.equipment.catalog.find((c) => c.id === offer.catalogId)!;
      expect(item.classId).toBe('mage');
      expect(['common', 'rare', 'superRare', 'epic']).toContain(item.rarity);
    }
    expect(new Date(shop.renewsAt).getTime()).toBeGreaterThan(Date.now());
    // Même heure : même assortiment.
    expect(await getShop()).toEqual(shop);
  });

  it('acheter un objet : l’or est débité, l’objet arrive dans l’inventaire, l’offre disparaît', async () => {
    const offer = (await getShop()).items[0]!;
    expect((await buy(offer.offerId)).json().error.code).toBe('NOT_ENOUGH_GOLD');

    await setGold(offer.price + 7);
    const response = await buy(offer.offerId);
    expect(response.statusCode, response.body).toBe(200);
    const { shop, save } = response.json() as { shop: ShopDto; save: SaveDto };
    expect(save.gold).toBe(7);
    expect(save.items.map((i) => i.catalogId)).toEqual([offer.catalogId]);
    expect(shop.items.some((i) => i.offerId === offer.offerId)).toBe(false);
    expect((await buy(offer.offerId)).json().error.code).toBe('OFFER_UNAVAILABLE');
    expect((await buy('item-99')).json().error.code).toBe('OFFER_UNAVAILABLE');
  });

  it('lots de ressources : une fois chacun ; les ressources de taverne à volonté', async () => {
    await setGold(1_000_000);
    const shop = await getShop();
    const lot = shop.lots[0]!;
    const { save } = (await buy(lot.offerId)).json() as { save: SaveDto };
    expect(save.resources[lot.resourceId]).toBe(lot.quantity);
    expect((await buy(lot.offerId)).json().error.code).toBe('OFFER_UNAVAILABLE');

    const glass = shop.permanentLots.find((l) => l.resourceId === 'verre')!;
    await buy(glass.offerId);
    const second = (await buy(glass.offerId)).json() as { save: SaveDto };
    expect(second.save.resources.verre).toBe(glass.quantity * 2);
    expect(second.save.gold).toBe(1_000_000 - lot.price - glass.price * 2);
  });

  it('personnages : 50 400 or le 2e, 232 400 or le 3e, une seule fois chaque classe', async () => {
    await setGold(50_400 + 232_400);
    const shop = await getShop();
    expect(shop.discount).toBe(0);
    expect(shop.characters.map((c) => c.price)).toEqual([50_400, 50_400]);

    const first = (await buy('class-warrior')).json() as { shop: ShopDto; save: SaveDto };
    expect(first.save.characters.map((c) => c.classId).sort()).toEqual(['mage', 'warrior']);
    const warrior = first.save.characters.find((c) => c.classId === 'warrior')!;
    expect(warrior.level).toBe(1);
    expect(warrior.skills).toHaveLength(3);
    expect(first.shop.characters).toEqual([
      { offerId: 'class-ranger', classId: 'ranger', price: 232_400 },
    ]);
    // Les objets vendus suivent les classes possédées.
    expect((await buy('class-warrior')).json().error.code).toBe('OFFER_UNAVAILABLE');

    const second = (await buy('class-ranger')).json() as { shop: ShopDto; save: SaveDto };
    expect(second.save.characters).toHaveLength(3);
    expect(second.save.gold).toBe(0);
    expect(second.shop.characters).toEqual([]);
  });

  it('l’assortiment se renouvelle à l’heure suivante', async () => {
    await setGold(1_000_000);
    const shop = await getShop();
    await buy(shop.items[0]!.offerId);
    // Simule le passage à l'heure suivante.
    await ctx.prisma.save.update({ where: { id: saveId }, data: { shopPeriod: -1 } });
    const renewed = await getShop();
    expect(renewed.items).toHaveLength(6);
  });

  it('revente : 20 % du prix boutique, pas d’objet équipé', async () => {
    const catalogItem = gameData.equipment.catalog.find(
      (c) => c.classId === 'mage' && c.slot === 'weapon1' && c.rarity === 'rare' && c.tier === 2,
    )!;
    const item = await ctx.prisma.item.create({ data: { saveId, catalogId: catalogItem.id } });
    const response = await post('/api/shop/sell', { itemId: item.id });
    expect(response.statusCode, response.body).toBe(200);
    const expected = sellPrice(gameData, catalogItem, 0);
    expect(expected).toBeGreaterThan(0);
    expect(response.json()).toMatchObject({ gold: expected, save: { gold: expected, items: [] } });

    const equipped = await ctx.prisma.item.create({ data: { saveId, catalogId: catalogItem.id } });
    const mage = await ctx.prisma.character.findFirstOrThrow();
    await post('/api/items/equip', { itemId: equipped.id, characterId: mage.id });
    expect((await post('/api/shop/sell', { itemId: equipped.id })).json().error.code).toBe(
      'ITEM_EQUIPPED',
    );
  });

  it('tout vendre : tous les objets d’un coup, ou aucun si l’un est équipé', async () => {
    const mageItem = gameData.equipment.catalog.find(
      (c) => c.classId === 'mage' && c.slot === 'hat' && c.rarity === 'common' && c.tier === 1,
    )!;
    // Objet d'une classe absente de l'équipe : revendable aussi.
    const warriorItem = gameData.equipment.catalog.find(
      (c) => c.classId === 'warrior' && c.slot === 'boots' && c.rarity === 'epic' && c.tier === 3,
    )!;
    const a = await ctx.prisma.item.create({ data: { saveId, catalogId: mageItem.id } });
    const b = await ctx.prisma.item.create({
      data: { saveId, catalogId: warriorItem.id, upgradeLevel: 2 },
    });
    const equipped = await ctx.prisma.item.create({ data: { saveId, catalogId: mageItem.id } });
    const mage = await ctx.prisma.character.findFirstOrThrow();
    await post('/api/items/equip', { itemId: equipped.id, characterId: mage.id });

    const refused = await post('/api/shop/sell-many', { itemIds: [a.id, b.id, equipped.id] });
    expect(refused.json().error.code).toBe('ITEM_EQUIPPED');
    expect(await ctx.prisma.item.count()).toBe(3);

    const response = await post('/api/shop/sell-many', { itemIds: [a.id, b.id, a.id] });
    expect(response.statusCode, response.body).toBe(200);
    const expected = sellPrice(gameData, mageItem, 0) + sellPrice(gameData, warriorItem, 2);
    expect(response.json()).toMatchObject({ gold: expected, save: { gold: expected } });
    expect((response.json() as { save: SaveDto }).save.items.map((i) => i.id)).toEqual([
      equipped.id,
    ]);
    expect((await post('/api/shop/sell-many', { itemIds: [] })).json().error.code).toBe(
      'VALIDATION',
    );
  });

  it('annuler une vente : l’objet revient (même identifiant, même amélioration) contre l’or reçu', async () => {
    const info = gameData.equipment.catalog.find(
      (c) => c.classId === 'mage' && c.slot === 'ring1' && c.rarity === 'epic' && c.tier === 2,
    )!;
    const a = await ctx.prisma.item.create({
      data: { saveId, catalogId: info.id, upgradeLevel: 4 },
    });
    const b = await ctx.prisma.item.create({ data: { saveId, catalogId: info.id } });
    const sold = (await post('/api/shop/sell-many', { itemIds: [a.id, b.id] })).json();
    const total = sellPrice(gameData, info, 4) + sellPrice(gameData, info, 0);
    expect(sold.gold).toBe(total);

    // L'or a été dépensé entre-temps : impossible de racheter.
    await setGold(total - 1);
    expect((await post('/api/shop/buy-back', { itemIds: [a.id, b.id] })).json().error.code).toBe(
      'NOT_ENOUGH_GOLD',
    );
    await setGold(total + 10);
    const back = await post('/api/shop/buy-back', { itemIds: [a.id] });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json()).toMatchObject({ gold: sellPrice(gameData, info, 4) });
    const save = back.json().save as SaveDto;
    expect(save.gold).toBe(total + 10 - sellPrice(gameData, info, 4));
    expect(save.items).toEqual([expect.objectContaining({ id: a.id, upgradeLevel: 4 })]);

    // Déjà rachetée : la vente ne s'annule pas deux fois. Une vente trop ancienne non plus.
    expect((await post('/api/shop/buy-back', { itemIds: [a.id] })).json().error.code).toBe(
      'SALE_EXPIRED',
    );
    await ctx.prisma.soldItem.update({
      where: { id: b.id },
      data: { soldAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    expect((await post('/api/shop/buy-back', { itemIds: [b.id] })).json().error.code).toBe(
      'SALE_EXPIRED',
    );
  });

  it('debug : réinitialiser la boutique', async () => {
    await setGold(1_000_000);
    const shop = await getShop();
    await buy(shop.items[0]!.offerId);
    const reset = (await post('/api/debug/reset-shop')).json() as ShopDto;
    expect(reset.items).toHaveLength(6);
  });
});
