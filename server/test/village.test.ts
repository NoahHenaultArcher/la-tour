import type { CollectResponse, SaveDto } from '@la-tour/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

const HOUR = 3_600_000;

describeWithDb('village', () => {
  let ctx: TestContext;
  let cookie: string;
  let saveId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    cookie = await register(ctx.app, 'Noah');
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
  });

  const post = (url: string, payload: object = {}) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const collect = async (): Promise<CollectResponse> => (await post('/api/village/collect')).json();
  const upgrade = (buildingId: string) => post('/api/village/upgrade', { buildingId });
  /** Recule la dernière collecte de `hours` heures (comme si le joueur était parti). */
  const goBack = (hours: number) =>
    ctx.prisma.save.update({
      where: { id: saveId },
      data: { lastIdleCollectAt: new Date(Date.now() - hours * HOUR) },
    });
  const setState = async (gold: number, resources: Record<string, number>) => {
    await ctx.prisma.save.update({ where: { id: saveId }, data: { gold } });
    for (const [resourceId, amount] of Object.entries(resources)) {
      await ctx.prisma.resourceStock.upsert({
        where: { saveId_resourceId: { saveId, resourceId } },
        create: { saveId, resourceId, amount },
        update: { amount },
      });
    }
  };
  const setBuilding = (buildingId: string, level: number) =>
    ctx.prisma.building.upsert({
      where: { saveId_buildingId: { saveId, buildingId } },
      create: { saveId, buildingId, level },
      update: { level },
    });

  it('produit pendant l’absence, d’après l’horloge du serveur', async () => {
    await goBack(2);
    const { save, report } = await collect();
    expect(report.produced).toEqual({ bois: 120, lin: 120, cuir: 120 });
    expect(report.elapsedHours).toBeCloseTo(2, 2);
    expect(save.resources).toEqual({ bois: 120, lin: 120, cuir: 120 });

    // Une collecte immédiate ne produit plus rien.
    expect((await collect()).report.produced).toEqual({});
  });

  it('s’arrête après 8 heures', async () => {
    await goBack(30);
    const { report } = await collect();
    expect(report.elapsedHours).toBeCloseTo(30, 2);
    expect(report.countedHours).toBe(8);
    expect(report.produced.bois).toBe(480);
  });

  it('est plafonnée par l’entrepôt', async () => {
    await setState(0, { bois: 990 });
    await goBack(8);
    const { save, report } = await collect();
    expect(save.resources.bois).toBe(1000);
    expect(report.full).toEqual(['bois']);
  });

  it('suit le niveau des bâtiments et de l’entrepôt', async () => {
    await setBuilding('scierie', 6);
    await setBuilding('entrepot', 3);
    await goBack(1);
    const { save } = await collect();
    expect(save.resources).toMatchObject({ bois: 106, chene: 90, frene: 90 });
  });

  it('améliore un bâtiment en débitant or et matériaux', async () => {
    await setState(600, { bois: 50 });
    const response = await upgrade('scierie');
    expect(response.statusCode, response.body).toBe(200);
    const save: SaveDto = response.json();
    expect(save.buildings.scierie).toBe(2);
    expect(save.gold).toBe(100); // 600 − 500
    expect(save.resources.bois).toBe(13); // 50 − 37
  });

  it('refuse sans assez d’or ou de matériaux, sans rien débiter', async () => {
    await setState(100, { bois: 50 });
    const response = await upgrade('scierie');
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'NOT_ENOUGH_RESOURCES',
      details: { floor: false, gold: 400, material: 0, coal: 0 },
    });
    const save = await ctx.prisma.save.findUniqueOrThrow({
      where: { id: saveId },
      include: { resources: true, buildings: true },
    });
    expect(Number(save.gold)).toBe(100);
    expect(save.resources.find((r) => r.resourceId === 'bois')!.amount).toBe(50);
    expect(save.buildings.find((b) => b.buildingId === 'scierie')!.level).toBe(1);
  });

  it('exige l’étage requis (pas de fer avant l’étage 15)', async () => {
    await setBuilding('scierie', 5);
    await setState(1_000_000, { fer: 1000, charbon: 1000 });
    const blocked = await upgrade('scierie');
    expect(blocked.json().error).toEqual({
      code: 'FLOOR_REQUIRED',
      details: { requiredFloor: 15 },
    });

    await ctx.prisma.save.update({
      where: { id: saveId },
      data: { bestFloorEver: 15, highestFloorCleared: 15 },
    });
    const ok = await upgrade('scierie');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().resources).toMatchObject({ fer: 1000 - 154, charbon: 1000 - 77 });
  });

  it('refuse un bâtiment verrouillé, inconnu, non améliorable ou au maximum', async () => {
    await setState(10_000_000, { bois: 100_000 });
    expect((await upgrade('mine')).json().error.code).toBe('BUILDING_LOCKED');
    expect((await upgrade('chateau')).statusCode).toBe(404);
    expect((await upgrade('tour')).json().error.code).toBe('NOT_UPGRADABLE');
    await setBuilding('taverne', 10);
    expect((await upgrade('taverne')).json().error.code).toBe('MAX_LEVEL');
  });

  it('deux améliorations simultanées ne dépensent jamais l’or deux fois', async () => {
    await setState(500, { bois: 100 });
    const [a, b] = await Promise.all([upgrade('scierie'), upgrade('champs')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const save = await ctx.prisma.save.findUniqueOrThrow({ where: { id: saveId } });
    expect(Number(save.gold)).toBe(0);
  });

  it('exige une session', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/village/collect' });
    expect(response.statusCode).toBe(401);
  });
});
