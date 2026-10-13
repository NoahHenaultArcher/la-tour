import type { SaveDto } from '@la-tour/shared';
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

describeWithDb('mode debug', () => {
  let ctx: TestContext;
  let admin: string;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    admin = await registerAdmin(ctx);
  });

  const debug = async (action: string, payload: object, cookie = admin) =>
    ctx.app.inject({ method: 'POST', url: `/api/debug/${action}`, headers: { cookie }, payload });
  const save = async (action: string, payload: object): Promise<SaveDto> => {
    const response = await debug(action, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  it('refuse un joueur qui n’est pas admin, et un visiteur', async () => {
    const player = await register(ctx.app, 'Joueur');
    expect((await debug('gold', { amount: 100 }, player)).statusCode).toBe(403);
    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/gold',
      payload: { amount: 100 },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('n’existe pas en production, même pour un admin', async () => {
    const prod = await createTestContext({ NODE_ENV: 'production' });
    try {
      const response = await prod.app.inject({
        method: 'POST',
        url: '/api/debug/gold',
        headers: { cookie: admin },
        payload: { amount: 100 },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await closeTestContext(prod);
    }
  });

  it('donne de l’or et des ressources', async () => {
    expect((await save('gold', { amount: 5000 })).gold).toBe(5000);
    expect((await save('gold', { amount: 1_000_000_000_000 })).gold).toBe(1_000_000_005_000);
    expect((await save('resources', { resourceId: 'fer', amount: 50 })).resources).toEqual({
      fer: 50,
    });
    const all = await save('resources', { resourceId: 'all', amount: 10 });
    expect(Object.keys(all.resources)).toHaveLength(33);
    expect(all.resources.fer).toBe(60);
    expect((await debug('resources', { resourceId: 'kryptonite', amount: 1 })).statusCode).toBe(
      400,
    );
    expect((await debug('gold', { amount: -5 })).statusCode).toBe(400);
  });

  it('donne de l’XP (montées de niveau) ou fixe le niveau', async () => {
    const characterId = (await save('gold', { amount: 1 })).characters[0]!.id;
    const leveled = await save('xp', { characterId, amount: 64 + 160 + 10 });
    expect(leveled.characters[0]).toMatchObject({ level: 3, xp: 10 });
    expect((await save('level', { characterId, level: 100 })).characters[0]).toMatchObject({
      level: 100,
      xp: 0,
      xpToNextLevel: null,
    });
  });

  it('n’agit pas sur le personnage d’un autre compte', async () => {
    const player = await register(ctx.app, 'Joueur');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/save/class',
      headers: { cookie: player },
      payload: { classId: 'warrior' },
    });
    const other = await ctx.prisma.character.findFirstOrThrow({ where: { class: 'warrior' } });
    expect((await debug('xp', { characterId: other.id, amount: 100 })).statusCode).toBe(404);
  });

  it('va à un étage : éléments et bâtiments débloqués en conséquence', async () => {
    const at31 = await save('floor', { floor: 31 });
    expect(at31).toMatchObject({ currentFloor: 31, highestFloorCleared: 30, bestFloorEver: 30 });
    expect(at31.unlockedElements).toEqual(['neutral', 'earth', 'fire']);
    expect(at31.buildings).toMatchObject({ mine: 1, atelier_fabrication: 1 });
    expect(at31.buildings.tour_alchimie).toBeUndefined();

    // Revenir plus bas garde les éléments et les bâtiments déjà débloqués.
    const back = await save('floor', { floor: 2 });
    expect(back).toMatchObject({ currentFloor: 2, highestFloorCleared: 1, bestFloorEver: 30 });
    expect(back.unlockedElements).toEqual(['neutral', 'earth', 'fire']);
    expect(back.buildings.mine).toBe(1);
  });

  it('débloque toute la tour ou un élément', async () => {
    const all = await save('unlock-tower', {});
    expect(all).toMatchObject({ currentFloor: 100, highestFloorCleared: 100 });
    expect(all.unlockedElements).toHaveLength(10);
    expect(all.buildings).toMatchObject({ tour_alchimie: 1, tour_amelioration: 1 });

    await resetDatabase(ctx.prisma);
    admin = await registerAdmin(ctx);
    expect((await save('element', { element: 'shadow' })).unlockedElements).toEqual([
      'neutral',
      'shadow',
    ]);
  });

  it('crée un objet (amélioration plafonnée au palier) et un Unique', async () => {
    const sword = await save('item', {
      classId: 'warrior',
      slot: 'weapon1',
      rarity: 'epic',
      tier: 2,
      upgradeLevel: 50,
    });
    expect(sword.items[0]).toMatchObject({
      catalogId: 'GUE-AR1-P2-EPI',
      upgradeLevel: 20,
      equippedBy: null,
    });
    const unique = await save('item', {
      classId: 'mage',
      slot: 'weapon1',
      rarity: 'unique',
      tier: 1,
      upgradeLevel: 5,
    });
    expect(unique.items[1]).toMatchObject({ catalogId: 'MAG-AR1-UNI', upgradeLevel: 5 });
  });

  it('avance l’horloge idle', async () => {
    const before = new Date((await save('gold', { amount: 1 })).lastIdleCollectAt).getTime();
    const after = new Date((await save('idle', { hours: 8 })).lastIdleCollectAt).getTime();
    expect(before - after).toBe(8 * 3_600_000);
  });
});
