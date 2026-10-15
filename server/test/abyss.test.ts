import type { CombatResponse, SaveDto } from '@la-tour/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('Abysse', () => {
  let ctx: TestContext;
  let cookie: string;
  let saveId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    // Compte admin (pour « Gagner la vague ») avec un Mage niveau 1.
    cookie = await registerAdmin(ctx);
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
    // Héros très fort (niveau 100, 40 héritages) : un Mage ordinaire tombe parfois entre deux vagues
    // gagnées par « Gagner la vague », ce qui rendrait les tests aléatoires.
    await ctx.prisma.character.updateMany({ where: { saveId }, data: { level: 100 } });
    await ctx.prisma.save.update({ where: { id: saveId }, data: { heritageCount: 40 } });
  });

  const post = (url: string, payload: object = {}) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const getSave = async (): Promise<SaveDto> =>
    (await ctx.app.inject({ method: 'GET', url: '/api/save', headers: { cookie } })).json();
  const winFloor = async (): Promise<CombatResponse> => {
    for (let i = 0; i < 10; i++) {
      const response: CombatResponse = (await post('/api/debug/win-wave')).json();
      if (response.outcome) return response;
    }
    throw new Error('Le combat ne se termine pas');
  };

  it("reste fermée tant que l'étage 100 n'est pas terminé", async () => {
    expect((await post('/api/combat/abyss')).json().error.code).toBe('ABYSS_LOCKED');
    const save = await getSave();
    expect(save).toMatchObject({ abyssFloor: 1, abyssCleared: 0, bestAbyssFloor: 0 });
  });

  it("terminer l'étage 100 ouvre l'Abysse", async () => {
    await ctx.prisma.save.update({
      where: { id: saveId },
      data: { currentFloor: 100, highestFloorCleared: 99, bestFloorEver: 99 },
    });
    expect((await post('/api/combat/start', { floor: 100 })).statusCode).toBe(200);
    const { outcome } = await winFloor();
    expect(outcome!.unlocked.abyss).toBe(true);
  });

  it('on joue toujours son propre étage ; la victoire fait descendre et bat le record', async () => {
    await post('/api/debug/unlock-tower');
    let response = await post('/api/combat/abyss');
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as CombatResponse).combat).toMatchObject({
      mode: 'abyss',
      floor: 1,
      phase: 'heroes',
    });
    let { outcome } = await winFloor();
    expect(outcome).toMatchObject({
      mode: 'abyss',
      floor: 1,
      result: 'victory',
      floorCleared: true,
    });
    expect(outcome!.save).toMatchObject({ abyssFloor: 2, abyssCleared: 1, bestAbyssFloor: 1 });

    // Étage de boss (5) : 5 vagues, butin du boss garanti.
    await post('/api/debug/abyss', { floor: 5 });
    response = await post('/api/combat/abyss');
    expect((response.json() as CombatResponse).combat).toMatchObject({
      floor: 5,
      floorType: 'boss',
      waveCount: 5,
    });
    ({ outcome } = await winFloor());
    expect(outcome!.loot.length).toBeGreaterThan(0);
    expect(outcome!.save).toMatchObject({ abyssFloor: 6, bestAbyssFloor: 5 });
  });

  it("l'héritage remet l'Abysse à zéro mais garde le record", async () => {
    await post('/api/debug/abyss', { floor: 12 });
    const response = await post('/api/save/heritage');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      abyssFloor: 1,
      abyssCleared: 0,
      bestAbyssFloor: 11,
      highestFloorCleared: 0,
    });
    expect((await post('/api/combat/abyss')).json().error.code).toBe('ABYSS_LOCKED');
  });
});
