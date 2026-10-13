import type { SaveDto } from '@la-tour/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('sauvegarde', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => resetDatabase(ctx.prisma));

  const getSave = (cookie?: string) =>
    ctx.app.inject({ method: 'GET', url: '/api/save', headers: cookie ? { cookie } : {} });
  const chooseClass = (cookie: string, classId: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/save/class',
      headers: { cookie },
      payload: { classId },
    });

  it('une nouvelle sauvegarde démarre à l’étage 1, sans personnage, avec les bâtiments de départ', async () => {
    const cookie = await register(ctx.app, 'Noah');
    const save: SaveDto = (await getSave(cookie)).json();
    expect(save).toMatchObject({
      gold: 0,
      currentFloor: 1,
      highestFloorCleared: 0,
      heritageCount: 0,
      unlockedElements: ['neutral'],
      characters: [],
      items: [],
      resources: {},
    });
    expect(save.buildings).toEqual({
      taverne: 1,
      entrepot: 1,
      scierie: 1,
      champs: 1,
      terrain_de_chasse: 1,
      tour: 1,
    });
  });

  it('exige une session', async () => {
    expect((await getSave()).statusCode).toBe(401);
  });

  it('choix de la classe : personnage niveau 1 avec le kit de départ', async () => {
    const cookie = await register(ctx.app, 'Noah');
    const response = await chooseClass(cookie, 'warrior');
    expect(response.statusCode).toBe(200);
    const save: SaveDto = response.json();
    expect(save.characters).toHaveLength(1);
    expect(save.characters[0]).toMatchObject({
      classId: 'warrior',
      level: 1,
      xp: 0,
      xpToNextLevel: 64,
      skills: [
        { position: 0, skillId: 'GUE-A01-NEU', fusionElement: null },
        { position: 1, skillId: 'GUE-A02-NEU', fusionElement: null },
        { position: 3, skillId: 'GUE-P01', fusionElement: null },
      ],
    });
  });

  it('la classe ne se choisit qu’une fois', async () => {
    const cookie = await register(ctx.app, 'Noah');
    await chooseClass(cookie, 'mage');
    const again = await chooseClass(cookie, 'ranger');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CLASS_ALREADY_CHOSEN');
    expect(await ctx.prisma.character.count()).toBe(1);
  });

  it('refuse une classe inconnue', async () => {
    const cookie = await register(ctx.app, 'Noah');
    expect((await chooseClass(cookie, 'paladin')).statusCode).toBe(400);
  });

  it('chaque compte ne voit que sa propre sauvegarde', async () => {
    const noah = await register(ctx.app, 'Noah');
    const alex = await register(ctx.app, 'Alex');
    await chooseClass(noah, 'ranger');
    expect((await getSave(alex)).json().characters).toEqual([]);
    expect((await getSave(noah)).json().characters[0].classId).toBe('ranger');
  });
});
