import { fusionCost, upgradeTowerCost, type SaveDto } from '@la-tour/shared';
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

describeWithDb('deck, fusions, Tour d’amélioration et héritage', () => {
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
    cookie = await registerAdmin(ctx); // un Mage niveau 1
    saveId = (await ctx.prisma.save.findFirstOrThrow()).id;
    mageId = (await ctx.prisma.character.findFirstOrThrow()).id;
  });

  const post = (url: string, payload: object = {}) =>
    ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const setDeck = (deck: { position: number; skillId: string; fusionElement?: string | null }[]) =>
    post('/api/characters/deck', {
      characterId: mageId,
      deck: deck.map((s) => ({ fusionElement: null, ...s })),
    });
  const setLevel = (level: number) =>
    ctx.prisma.character.update({ where: { id: mageId }, data: { level, bestLevel: level } });
  const unlock = (elements: string[], extra: object = {}) =>
    ctx.prisma.save.update({
      where: { id: saveId },
      data: { unlockedElements: elements, ...extra },
    });
  const stock = (resources: Record<string, number>, gold: number) =>
    Promise.all([
      ctx.prisma.save.update({ where: { id: saveId }, data: { gold: BigInt(gold) } }),
      ...Object.entries(resources).map(([resourceId, amount]) =>
        ctx.prisma.resourceStock.upsert({
          where: { saveId_resourceId: { saveId, resourceId } },
          create: { saveId, resourceId, amount },
          update: { amount },
        }),
      ),
    ]);

  it('deck : compétences débloquées par niveau et par élément, une seule ultime, une version par base', async () => {
    // Tornade arcanique (niveau 8) : verrouillée au niveau 1.
    expect((await setDeck([{ position: 0, skillId: 'MAG-A03-NEU' }])).json().error.code).toBe(
      'SKILL_LOCKED',
    );
    await setLevel(60);
    const ok = await setDeck([
      { position: 0, skillId: 'MAG-A01-NEU' },
      { position: 1, skillId: 'MAG-A03-NEU' },
      { position: 2, skillId: 'MAG-A07-NEU' },
      { position: 3, skillId: 'MAG-P02' },
      { position: 4, skillId: 'TOU-AFF-NEU' },
    ]);
    expect(ok.statusCode, ok.body).toBe(200);
    const mage = (ok.json() as SaveDto).characters[0]!;
    expect(mage.skills.map((s) => s.skillId)).toEqual([
      'MAG-A01-NEU',
      'MAG-A03-NEU',
      'MAG-A07-NEU',
      'MAG-P02',
      'TOU-AFF-NEU',
    ]);

    // Deux ultimes, deux versions de la même base, élément pas débloqué, passif en position active.
    const errors = await Promise.all([
      setDeck([
        { position: 0, skillId: 'MAG-A07-NEU' },
        { position: 1, skillId: 'MAG-A08-NEU' },
      ]),
      setDeck([
        { position: 0, skillId: 'MAG-A01-NEU' },
        { position: 1, skillId: 'MAG-A03-NEU' },
        { position: 2, skillId: 'MAG-A03-NEU' },
      ]),
      setDeck([{ position: 0, skillId: 'MAG-A01-FEU' }]),
      setDeck([{ position: 0, skillId: 'MAG-P02' }]),
      setDeck([{ position: 3, skillId: 'MAG-P02' }]),
    ]);
    expect(errors.map((r) => r.json().error.code)).toEqual([
      'TOO_MANY_ULTIMATES',
      'DUPLICATE_SKILL',
      'SKILL_LOCKED',
      'INVALID_DECK',
      'INVALID_DECK',
    ]);
    // Deux éléments de la même compétence de base : refusé aussi.
    await unlock(['neutral', 'fire']);
    expect(
      (
        await setDeck([
          { position: 0, skillId: 'MAG-A01-NEU' },
          { position: 1, skillId: 'MAG-A01-FEU' },
        ])
      ).json().error.code,
    ).toBe('DUPLICATE_SKILL');
    // Une autre classe ne peut pas emprunter les compétences du Guerrier.
    expect((await setDeck([{ position: 0, skillId: 'GUE-A01-NEU' }])).json().error.code).toBe(
      'INVALID_DECK',
    );
  });

  it('fusions : Tour d’alchimie requise, payées en éther et en or, une par héros au niveau 1', async () => {
    await setLevel(60);
    await unlock(['neutral', 'earth', 'fire']);
    const fused = [
      { position: 0, skillId: 'MAG-A01-FEU', fusionElement: 'earth' },
      { position: 1, skillId: 'MAG-A02-NEU' },
    ];
    expect((await setDeck(fused)).json().error.code).toBe('FUSION_LOCKED');

    await ctx.prisma.building.create({ data: { saveId, buildingId: 'tour_alchimie', level: 1 } });
    const cost = fusionCost(1);
    await stock({ ether: cost.ether - 1 }, cost.gold);
    expect((await setDeck(fused)).json().error.code).toBe('NOT_ENOUGH_RESOURCES');

    await stock({ ether: cost.ether + 10 }, cost.gold + 5);
    const response = await setDeck(fused);
    expect(response.statusCode, response.body).toBe(200);
    const save = response.json() as SaveDto;
    expect(save.gold).toBe(5);
    expect(save.resources.ether).toBe(10);
    expect(save.characters[0]!.skills[0]).toMatchObject({ fusionElement: 'earth' });

    // Déplacer la compétence fusionnée est gratuit ; une 2e fusion dépasse la limite du niveau 1.
    const moved = await setDeck([
      { position: 1, skillId: 'MAG-A01-FEU', fusionElement: 'earth' },
      { position: 0, skillId: 'MAG-A02-NEU' },
    ]);
    expect((moved.json() as SaveDto).gold).toBe(5);
    expect(
      (
        await setDeck([
          { position: 0, skillId: 'MAG-A01-FEU', fusionElement: 'earth' },
          { position: 1, skillId: 'MAG-A02-NEU', fusionElement: 'fire' },
        ])
      ).json().error.code,
    ).toBe('TOO_MANY_FUSIONS');
    // Une fusion sur un soutien est refusée.
    expect(
      (
        await setDeck([
          { position: 0, skillId: 'MAG-A02-NEU' },
          { position: 1, skillId: 'MAG-S01-FEU', fusionElement: 'earth' },
        ])
      ).json().error.code,
    ).toBe('FUSION_LOCKED');
  });

  it('les fusions et le deck sont utilisés en combat', async () => {
    await setLevel(30);
    await unlock(['neutral', 'fire']);
    await setDeck([
      { position: 0, skillId: 'MAG-A01-FEU' },
      { position: 1, skillId: 'MAG-S02-NEU' },
    ]);
    const start = await post('/api/combat/start', { floor: 1 });
    expect(start.statusCode, start.body).toBe(200);
    const hero = start.json().combat.heroes[0];
    expect(hero.skills.map((s: { skillId: string }) => s.skillId)).toEqual([
      'MAG-A01-FEU',
      'MAG-S02-NEU',
    ]);
    // Un soin se lance sans cible.
    const heal = await post('/api/combat/action', { heroId: hero.id, skillId: 'MAG-S02-NEU' });
    expect(heal.statusCode, heal.body).toBe(200);
  });

  it('Tour d’amélioration : débloquée à l’étage 100, or + éther + ressource de la branche', async () => {
    expect((await post('/api/village/upgrade-tower', { branch: 'damage' })).json().error.code).toBe(
      'BUILDING_LOCKED',
    );
    await ctx.prisma.building.create({
      data: { saveId, buildingId: 'tour_amelioration', level: 1 },
    });
    const cost = upgradeTowerCost(gameData.village, 1);
    await stock({ ether: cost.ether, adamantite: cost.branchResource }, cost.gold);
    const response = await post('/api/village/upgrade-tower', { branch: 'damage' });
    expect(response.statusCode, response.body).toBe(200);
    const save = response.json() as SaveDto;
    expect(save.upgradeTower.damage).toBe(1);
    expect(save.gold).toBe(0);
    expect(save.resources.ether).toBe(0);
    expect(save.resources.adamantite).toBe(0);
    expect((await post('/api/village/upgrade-tower', { branch: 'damage' })).json().error.code).toBe(
      'NOT_ENOUGH_RESOURCES',
    );
  });

  it('héritage : un héros niveau 100 et la tour conquise, tout le compte repart avec +25 %', async () => {
    expect((await post('/api/save/heritage')).json().error.code).toBe('HERITAGE_LOCKED');
    await setLevel(100);
    // Niveau 100 mais tour pas encore conquise.
    await ctx.prisma.save.update({ where: { id: saveId }, data: { highestFloorCleared: 99 } });
    expect((await post('/api/save/heritage')).json().error.code).toBe('HERITAGE_LOCKED');
    await ctx.prisma.character.update({
      where: { id: mageId },
      data: { statPoints: { magic: 20 } },
    });
    await unlock(['neutral', 'earth'], {
      currentFloor: 100,
      highestFloorCleared: 100,
      bestFloorEver: 100,
      gold: 1234n,
    });
    await setDeck([
      { position: 0, skillId: 'MAG-A01-NEU' },
      { position: 1, skillId: 'MAG-A08-TER' },
    ]);
    const response = await post('/api/save/heritage');
    expect(response.statusCode, response.body).toBe(200);
    const save = response.json() as SaveDto;
    expect(save).toMatchObject({
      heritageCount: 1,
      currentFloor: 1,
      highestFloorCleared: 0,
      bestFloorEver: 100,
      gold: 1234,
      unlockedElements: ['neutral', 'earth'],
    });
    const mage = save.characters[0]!;
    expect(mage).toMatchObject({ level: 1, bestLevel: 100, xp: 0 });
    expect(mage.statPoints.available).toBe(0);
    expect(mage.statPoints.allocated.magic).toBe(0);
    // Les compétences débloquées restent : Explosion arcanique (niveau 60) toujours dans le deck.
    expect(mage.skills.map((s) => s.skillId)).toContain('MAG-A08-TER');
    expect(
      (
        await setDeck([
          { position: 0, skillId: 'MAG-A01-NEU' },
          { position: 1, skillId: 'MAG-A08-TER' },
        ])
      ).statusCode,
    ).toBe(200);
    // Plus de niveau 100 ni de tour conquise : pas de second héritage d'affilée.
    expect((await post('/api/save/heritage')).json().error.code).toBe('HERITAGE_LOCKED');
    // Un héros remonté au niveau 100 ne suffit pas : il faut reconquérir la tour.
    await setLevel(100);
    expect((await post('/api/save/heritage')).json().error.code).toBe('HERITAGE_LOCKED');
  });
});
