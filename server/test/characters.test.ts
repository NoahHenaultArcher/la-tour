import type { CombatResponse, SaveDto } from '@la-tour/shared';
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

describeWithDb('points de statistiques', () => {
  let ctx: TestContext;
  let cookie: string;
  let mageId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    cookie = await registerAdmin(ctx); // un Mage
    mageId = (await ctx.prisma.character.findFirstOrThrow()).id;
    await ctx.prisma.character.update({ where: { id: mageId }, data: { level: 3 } });
  });

  const post = (url: string, payload: object, who = cookie) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie: who }, payload });
  const mage = (save: SaveDto) => save.characters.find((c) => c.id === mageId)!;

  it('chaque niveau donne 5 points à répartir', async () => {
    const save: SaveDto = (
      await ctx.app.inject({ method: 'GET', url: '/api/save', headers: { cookie } })
    ).json();
    expect(mage(save).statPoints).toEqual({
      allocated: { vitality: 0, strength: 0, resistance: 0, magic: 0, agility: 0 },
      available: 10,
      total: 10,
    });
  });

  it('répartit les points, sans dépasser ceux gagnés', async () => {
    const response = await post('/api/characters/stats', {
      characterId: mageId,
      add: { magic: 6, vitality: 4 },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(mage(response.json()).statPoints).toMatchObject({
      available: 0,
      allocated: { magic: 6, vitality: 4 },
    });
    const tooMany = await post('/api/characters/stats', {
      characterId: mageId,
      add: { agility: 1 },
    });
    expect(tooMany.json().error.code).toBe('NOT_ENOUGH_POINTS');
    expect(
      (await post('/api/characters/stats', { characterId: mageId, add: { initiative: 1 } }))
        .statusCode,
    ).toBe(400);
  });

  it('les points comptent en combat', async () => {
    const magicIn = async () => {
      const response: CombatResponse = (await post('/api/combat/start', { floor: 1 })).json();
      await post('/api/combat/forfeit', {});
      return response.combat!.heroes[0]!.stats.magic;
    };
    const before = await magicIn();
    await post('/api/characters/stats', { characterId: mageId, add: { magic: 10 } });
    // +10 Magie, puis le passif du Mage (+8 %) : entre +10 et +11.
    const gain = (await magicIn()) - before;
    expect(gain).toBeGreaterThanOrEqual(10);
    expect(gain).toBeLessThanOrEqual(11);
  });

  it('se réinitialisent gratuitement', async () => {
    await post('/api/characters/stats', { characterId: mageId, add: { magic: 10 } });
    const save: SaveDto = (
      await post('/api/characters/stats/reset', { characterId: mageId })
    ).json();
    expect(mage(save).statPoints.available).toBe(10);
  });

  it('refuse le personnage d’un autre compte', async () => {
    const other = await register(ctx.app, 'Autre');
    expect(
      (await post('/api/characters/stats', { characterId: mageId, add: { magic: 1 } }, other))
        .statusCode,
    ).toBe(404);
  });
});
