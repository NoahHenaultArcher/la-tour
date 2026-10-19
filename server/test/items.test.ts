import { upgradeQuantity, type CombatResponse, type SaveDto } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('équipement, Atelier et butin', () => {
  let ctx: TestContext;
  let cookie: string;
  let saveId: string;
  let mageId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    cookie = await registerAdmin(ctx); // admin avec un Mage
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
    mageId = (await ctx.prisma.character.findFirstOrThrow()).id;
  });

  const post = (url: string, payload: object = {}, who = cookie) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie: who }, payload });
  const ok = async (url: string, payload: object = {}): Promise<SaveDto> => {
    const response = await post(url, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const createItem = async (catalogId: string, upgradeLevel = 0) =>
    (await ctx.prisma.item.create({ data: { saveId, catalogId, upgradeLevel } })).id;
  const setStock = (resourceId: string, amount: number) =>
    ctx.prisma.resourceStock.upsert({
      where: { saveId_resourceId: { saveId, resourceId } },
      create: { saveId, resourceId, amount },
      update: { amount },
    });
  const unlockWorkshop = () => ok('/api/debug/floor', { floor: 16 });

  it('équipe un objet de la classe ; l’ancien du même slot retourne dans l’inventaire', async () => {
    const hatA = await createItem('MAG-CHA-P1-COM');
    const hatB = await createItem('MAG-CHA-P1-RAR');
    let save = await ok('/api/items/equip', { itemId: hatA, characterId: mageId });
    expect(save.items.find((i) => i.id === hatA)).toMatchObject({
      equippedBy: mageId,
      slot: 'hat',
    });
    save = await ok('/api/items/equip', { itemId: hatB, characterId: mageId });
    expect(save.items.find((i) => i.id === hatA)).toMatchObject({ equippedBy: null, slot: null });
    expect(save.items.find((i) => i.id === hatB)).toMatchObject({
      equippedBy: mageId,
      slot: 'hat',
    });
    save = await ok('/api/items/unequip', { itemId: hatB });
    expect(save.items.every((i) => i.equippedBy === null)).toBe(true);
  });

  it('refuse l’objet d’une autre classe ou d’un autre compte', async () => {
    const sword = await createItem('GUE-AR1-P1-COM');
    expect(
      (await post('/api/items/equip', { itemId: sword, characterId: mageId })).json().error.code,
    ).toBe('WRONG_CLASS');
    const other = await register(ctx.app, 'Voleur');
    expect(
      (await post('/api/items/equip', { itemId: sword, characterId: mageId }, other)).statusCode,
    ).toBe(404);
  });

  it('l’équipement porté renforce le héros en combat', async () => {
    const start = async () => {
      const response: CombatResponse = (await post('/api/combat/start', { floor: 1 })).json();
      await post('/api/combat/forfeit');
      return response.combat!.heroes[0]!.stats;
    };
    const naked = await start();
    const robe = await createItem('MAG-ARM-P5-LEG', 30);
    await ok('/api/items/equip', { itemId: robe, characterId: mageId });
    const dressed = await start();
    expect(dressed.maxHp).toBeGreaterThan(naked.maxHp);
    expect(dressed.armor).toBeGreaterThan(naked.armor);
  });

  it('l’Atelier se débloque à l’étage 15 et améliore avec le matériau de l’objet', async () => {
    const staff = await createItem('MAG-AR1-P1-COM'); // Bâton en bois
    expect((await post('/api/workshop/upgrade', { itemId: staff })).json().error.code).toBe(
      'BUILDING_LOCKED',
    );
    await unlockWorkshop();
    await setStock('bois', 10);
    const save = await ok('/api/workshop/upgrade', { itemId: staff });
    expect(save.items.find((i) => i.id === staff)!.upgradeLevel).toBe(1);
    expect(save.resources.bois).toBe(7); // 3 bois pour le niveau 1
  });

  it('refuse un palier pas encore ouvert, un objet au maximum ou sans ressources', async () => {
    await unlockWorkshop();
    const steel = await createItem('MAG-AR1-P3-COM');
    await setStock('ebene', 10_000);
    expect((await post('/api/workshop/upgrade', { itemId: steel })).json().error).toMatchObject({
      code: 'TIER_LOCKED',
    });
    const maxed = await createItem('MAG-AR1-P1-COM', 19);
    expect((await post('/api/workshop/upgrade', { itemId: maxed })).json().error.code).toBe(
      'ITEM_MAX_LEVEL',
    );
    const poor = await createItem('MAG-AR1-P1-COM', 10);
    await setStock('bois', 5);
    const needed = upgradeQuantity(gameData.equipment, 'common', 11);
    const error = (await post('/api/workshop/upgrade', { itemId: poor })).json().error;
    expect(error.code).toBe('NOT_ENOUGH_RESOURCES');
    expect(error.details.resourceId).toBe('bois');
    // La collecte idle juste avant peut avoir ajouté un peu de bois.
    expect(error.details.missing).toBeGreaterThan(0);
    expect(error.details.missing).toBeLessThanOrEqual(needed - 5);
  });

  it('fabrique un objet +0 (rareté tirée) pour une classe de l’équipe', async () => {
    await unlockWorkshop();
    await setStock('lin', 20);
    const save = await ok('/api/workshop/craft', { classId: 'mage', slot: 'hat', tier: 1 });
    // Commun le plus souvent, parfois mieux : même emplacement et même palier.
    expect(save.items.at(-1)!.catalogId).toMatch(/^MAG-CHA-P1-(COM|RAR|SRA|EPI|MYT|LEG)$/);
    expect(save.items.at(-1)!.upgradeLevel).toBe(0);
    expect(save.resources.lin).toBeLessThan(20);
    expect(
      (await post('/api/workshop/craft', { classId: 'warrior', slot: 'hat', tier: 1 })).json().error
        .code,
    ).toBe('CLASS_NOT_OWNED');
    expect(
      (await post('/api/workshop/craft', { classId: 'mage', slot: 'hat', tier: 4 })).json().error
        .code,
    ).toBe('TIER_LOCKED');
  });

  it('battre un boss rapporte au moins un objet, ajouté à l’inventaire', async () => {
    await ctx.prisma.save.update({
      where: { id: saveId },
      data: { currentFloor: 5, highestFloorCleared: 4, bestFloorEver: 4 },
    });
    await post('/api/combat/start', { floor: 5 });
    let response: CombatResponse | null = null;
    for (let i = 0; i < 10 && !response?.outcome; i++)
      response = (await post('/api/debug/win-wave')).json();
    const { loot, save } = response!.outcome!;
    expect(loot.length).toBeGreaterThanOrEqual(1);
    for (const drop of loot) {
      // Toutes les classes peuvent tomber, même celles absentes de l'équipe (ici un seul Mage).
      expect(drop.catalogId).toMatch(/^(GUE|MAG|TIR)-/);
      expect(save.items.some((i) => i.id === drop.itemId && i.upgradeLevel === 0)).toBe(true);
    }
  });
});
