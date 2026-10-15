import { createRng, type CombatResponse, type SaveDto } from '@la-tour/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { grantRelics } from '../src/relics/service.ts';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('reliques', () => {
  let ctx: TestContext;
  let cookie: string;
  let saveId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    cookie = await registerAdmin(ctx);
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
  });

  const post = (url: string, payload: object = {}) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const equip = (relicId: string, slot: number) => post('/api/relics/equip', { relicId, slot });

  it('équiper, échanger et retirer ; 6 emplacements, une relique par emplacement', async () => {
    expect((await equip('REL-07', 0)).json().error.code).toBe('NOT_FOUND');
    await post('/api/debug/relic', { relicId: 'all' });
    let save: SaveDto = (await equip('REL-07', 0)).json();
    expect(save.relics.find((r) => r.relicId === 'REL-07')!.slot).toBe(0);
    // Une autre relique dans le même emplacement : la première retourne dans l'inventaire.
    save = (await equip('OEUF-FEU', 0)).json();
    expect(save.relics.find((r) => r.relicId === 'REL-07')!.slot).toBeNull();
    expect(save.relics.find((r) => r.relicId === 'OEUF-FEU')!.slot).toBe(0);
    // Déplacer une relique équipée vers un autre emplacement.
    save = (await equip('OEUF-FEU', 5)).json();
    expect(save.relics.filter((r) => r.slot !== null)).toEqual([{ relicId: 'OEUF-FEU', slot: 5 }]);
    expect((await equip('OEUF-FEU', 6)).json().error.code).toBe('VALIDATION');
    save = (await post('/api/relics/unequip', { relicId: 'OEUF-FEU' })).json();
    expect(save.relics.every((r) => r.slot === null)).toBe(true);
    expect(save.relics).toHaveLength(30);
  });

  it('les reliques équipées comptent en combat', async () => {
    await post('/api/debug/relic', { relicId: 'REL-18' }); // Égide de l'archange
    await equip('REL-18', 2);
    const response: CombatResponse = (await post('/api/combat/start', { floor: 1 })).json();
    expect(response.combat!.relics).toEqual(['REL-18']);
    expect(response.combat!.heroes[0]!.shield).toBeGreaterThan(0);
    expect((await equip('REL-18', 3)).json().error.code).toBe('COMBAT_IN_PROGRESS');
  });

  it('5 % de chance par boss vaincu, une seule fois par compte, jamais en chasse', async () => {
    const boss = [{ monsterId: 'MON-004', level: 5, xp: 1, gold: 1 }];
    const rng = createRng(42);
    const hunt = await ctx.prisma.$transaction((tx) =>
      Promise.all(Array.from({ length: 100 }, () => grantRelics(tx, saveId, rng, boss, 'hunt'))),
    );
    expect(hunt.flat()).toEqual([]);
    let gained: string[] = [];
    for (let i = 0; i < 300 && gained.length === 0; i++)
      gained = await ctx.prisma.$transaction((tx) => grantRelics(tx, saveId, rng, boss, 'tower'));
    expect(gained).toEqual(['REL-01']);
    for (let i = 0; i < 200; i++)
      expect(
        await ctx.prisma.$transaction((tx) => grantRelics(tx, saveId, rng, boss, 'abyss')),
      ).toEqual([]);
    expect(await ctx.prisma.relic.count({ where: { saveId } })).toBe(1);
  });

  it('chaque fin de combat renvoie les reliques obtenues', async () => {
    await post('/api/combat/start', { floor: 1 });
    let outcome: CombatResponse['outcome'] = null;
    for (let i = 0; i < 5 && !outcome; i++)
      outcome = ((await post('/api/debug/win-wave')).json() as CombatResponse).outcome;
    expect(outcome!.relics).toEqual([]);
  });
});
