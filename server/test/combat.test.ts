import type { CombatResponse } from '@la-tour/shared';
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

describeWithDb('combat et tour', () => {
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
  });

  const post = (url: string, payload: object = {}, who = cookie) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie: who }, payload });
  const start = (floor: number) => post('/api/combat/start', { floor });
  const winWave = async (): Promise<CombatResponse> => (await post('/api/debug/win-wave')).json();
  const winFloor = async (): Promise<CombatResponse> => {
    for (let i = 0; i < 10; i++) {
      const response = await winWave();
      if (response.outcome) return response;
    }
    throw new Error('Le combat ne se termine pas');
  };
  const setProgress = (currentFloor: number, highestFloorCleared: number) =>
    ctx.prisma.save.update({
      where: { id: saveId },
      data: { currentFloor, highestFloorCleared, bestFloorEver: highestFloorCleared },
    });

  it('lance un combat sur l’étage courant ; le client ne voit ni la graine ni les vagues à venir', async () => {
    const response = await start(1);
    expect(response.statusCode, response.body).toBe(200);
    const body: CombatResponse = response.json();
    expect(body.combat).toMatchObject({
      floor: 1,
      floorType: 'normal',
      waveIndex: 0,
      waveCount: 3,
      phase: 'heroes',
    });
    expect(body.combat).not.toHaveProperty('rng');
    expect(body.combat).not.toHaveProperty('waves');
    expect(body.events[0]).toMatchObject({ type: 'wave', wave: 1, total: 3 });

    const current = await ctx.app.inject({
      method: 'GET',
      url: '/api/combat',
      headers: { cookie },
    });
    expect(current.json().combat.floor).toBe(1);
    expect((await start(1)).json().error.code).toBe('COMBAT_IN_PROGRESS');
  });

  it('les Uniques équipés emportent leur passif en combat', async () => {
    const mage = await ctx.prisma.character.findFirstOrThrow({ where: { saveId } });
    await ctx.prisma.item.create({
      data: {
        saveId,
        catalogId: 'MAG-AR1-UNI',
        equippedById: mage.id,
        equippedSlot: 'weapon1',
      },
    });
    await ctx.prisma.item.create({ data: { saveId, catalogId: 'MAG-CHA-UNI' } });
    expect((await start(1)).statusCode).toBe(200);
    const session = await ctx.prisma.combatSession.findUniqueOrThrow({ where: { saveId } });
    const state = session.state as { heroes: { uniques: string[] }[] };
    // Seul l'Unique porté compte (l'autre est dans l'inventaire).
    expect(state.heroes[0]!.uniques).toEqual(['MAG-AR1-UNI']);
  });

  it('refuse un étage verrouillé ou un étage normal déjà passé', async () => {
    expect((await start(2)).json().error.code).toBe('FLOOR_LOCKED');
    await setProgress(7, 6);
    expect((await start(4)).json().error.code).toBe('FLOOR_LOCKED');
    expect((await start(5)).statusCode).toBe(200); // boss rejouable
  });

  it('exige un personnage', async () => {
    const other = await register(ctx.app, 'SansClasse');
    expect((await post('/api/combat/start', { floor: 1 }, other)).json().error.code).toBe(
      'NO_CHARACTER',
    );
  });

  it('refuse une action invalide sans rien modifier', async () => {
    const { combat } = (await start(1)).json() as CombatResponse;
    const bad = await post('/api/combat/action', {
      heroId: 'h0',
      skillId: 'MAG-A01-NEU',
      targetId: 'm99',
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('INVALID_TARGET');
    const other = await post('/api/combat/action', {
      heroId: 'h0',
      skillId: 'GUE-A01-NEU',
      targetId: combat!.monsters[0]!.id,
    });
    expect(other.json().error.code).toBe('INVALID_SKILL');
  });

  it('une action valide est calculée par le serveur', async () => {
    const { combat } = (await start(1)).json() as CombatResponse;
    const target = combat!.monsters.find((m) => m.hp > 0)!;
    const response = await post('/api/combat/action', {
      heroId: 'h0',
      skillId: 'MAG-A01-NEU',
      targetId: target.id,
    });
    expect(response.statusCode, response.body).toBe(200);
    const body: CombatResponse = response.json();
    expect(body.events[0]).toMatchObject({ type: 'action', actorId: 'h0', skillId: 'MAG-A01-NEU' });
  });

  it('victoire : or, XP, étage suivant ; le combat est terminé', async () => {
    await start(1);
    const { outcome } = await winFloor();
    expect(outcome).toMatchObject({ result: 'victory', floor: 1, floorCleared: true });
    expect(outcome!.gold).toBeGreaterThan(0);
    expect(outcome!.save).toMatchObject({
      currentFloor: 2,
      highestFloorCleared: 1,
      gold: outcome!.gold,
    });
    expect(outcome!.save.characters[0]!.xp + outcome!.save.characters[0]!.level).toBeGreaterThan(1);
    expect(await ctx.prisma.combatSession.count()).toBe(0);
  });

  it('battre un boss débloque sa zone de chasse ; l’étage 15 débloque la Mine et l’Atelier', async () => {
    await setProgress(5, 4);
    await start(5);
    expect((await winFloor()).outcome!.unlocked.huntingZones).toEqual(['Forêt de chasse']);

    // Un héros de niveau 1 peut tomber entre deux vagues de l'étage 15 : on le met au niveau de l'étage.
    const character = await ctx.prisma.character.findFirstOrThrow();
    await ctx.prisma.character.update({ where: { id: character.id }, data: { level: 15 } });
    await setProgress(15, 14);
    await start(15);
    const { outcome } = await winFloor();
    expect(outcome!.result).toBe('victory');
    expect(outcome!.unlocked.buildings.sort()).toEqual(['atelier_fabrication', 'mine']);
    expect(outcome!.save.buildings.mine).toBe(1);
  });

  it('rejouer un boss rapporte de l’or et de l’XP mais ne fait pas monter', async () => {
    await setProgress(7, 6);
    await start(5);
    const { outcome } = await winFloor();
    expect(outcome).toMatchObject({ result: 'victory', floorCleared: false });
    expect(outcome!.save.currentFloor).toBe(7);
    expect(outcome!.gold).toBeGreaterThan(0);
  });

  it('défaite : l’XP et l’or déjà gagnés sont conservés, l’étage n’est pas validé', async () => {
    await start(1);
    await winWave();
    const response: CombatResponse = (await post('/api/combat/forfeit')).json();
    expect(response.outcome).toMatchObject({ result: 'defeat', floorCleared: false });
    expect(response.outcome!.gold).toBeGreaterThan(0);
    expect(response.outcome!.save.currentFloor).toBe(1);
  });

  it('mode auto : l’IA joue jusqu’à la fin du combat', async () => {
    const character = await ctx.prisma.character.findFirstOrThrow();
    await ctx.prisma.character.update({ where: { id: character.id }, data: { level: 40 } });
    await start(1);
    let response: CombatResponse | null = null;
    for (let i = 0; i < 100 && !response?.outcome; i++)
      response = (await post('/api/combat/auto')).json();
    expect(response!.outcome).toMatchObject({ result: 'victory' });
  });

  it('chasse : zone verrouillée tant que son boss n’est pas battu', async () => {
    expect((await post('/api/combat/hunt', { zoneFloor: 5 })).json().error.code).toBe(
      'ZONE_LOCKED',
    );
    // Étage 9 : tannière de dragon, sans zone de chasse ; étage 4 : pas un boss.
    await setProgress(11, 10);
    for (const zoneFloor of [4, 9, 15]) {
      expect((await post('/api/combat/hunt', { zoneFloor })).json().error.code).toBe('ZONE_LOCKED');
    }
    expect((await post('/api/combat/hunt', { zoneFloor: 10 })).statusCode).toBe(200);
  });

  it('chasse : vagues sans fin, quitter garde les récompenses sans faire monter', async () => {
    await setProgress(7, 6);
    const response = await post('/api/combat/hunt', { zoneFloor: 5 });
    expect(response.statusCode, response.body).toBe(200);
    const { combat } = response.json() as CombatResponse;
    expect(combat).toMatchObject({ mode: 'hunt', floor: 5, floorType: 'normal', waveCount: 1 });
    for (const monster of combat!.monsters) {
      expect(monster.level).toBeGreaterThanOrEqual(5);
      expect(monster.level).toBeLessThanOrEqual(15);
    }

    // Trois vagues gagnées : le combat continue toujours.
    for (let i = 0; i < 3; i++) {
      const wave = await winWave();
      expect(wave.outcome).toBeNull();
      expect(wave.combat!.waveIndex).toBe(i + 1);
    }
    const { outcome } = (await post('/api/combat/retreat')).json() as CombatResponse;
    expect(outcome).toMatchObject({ result: 'retreat', mode: 'hunt', floorCleared: false });
    expect(outcome!.gold).toBeGreaterThan(0);
    expect(outcome!.save).toMatchObject({ currentFloor: 7, highestFloorCleared: 6 });
    expect(await ctx.prisma.combatSession.count()).toBe(0);

    await start(7);
    expect((await post('/api/combat/retreat')).json().error.code).toBe('NOT_A_HUNT');
  });

  it('exige une session', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/combat/start',
      payload: { floor: 1 },
    });
    expect(response.statusCode).toBe(401);
  });
});
