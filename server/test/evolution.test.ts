import { fusionCost, starterDeckFor, type SaveDto } from '@la-tour/shared';
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

describeWithDb('évolutions des classes (héritages 10 et 20)', () => {
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
  const setHeritage = (count: number) => post('/api/debug/heritage', { count });
  const addWarrior = async () =>
    (
      await ctx.prisma.character.create({
        data: { saveId, class: 'warrior', skills: { create: starterDeckFor(gameData, 'warrior') } },
      })
    ).id;
  const item = async (catalogId: string) =>
    (await ctx.prisma.item.create({ data: { saveId, catalogId } })).id;

  it('Maître d’armes : 3e emplacement d’arme (épée ou bouclier), à partir du 20e héritage', async () => {
    const warriorId = await addWarrior();
    const sword = await item('GUE-AR1-P1-COM');
    const shield = await item('GUE-AR2-P1-COM');
    const hat = await item('GUE-CHA-P1-COM');
    const equip3 = (itemId: string) =>
      post('/api/items/equip', { itemId, characterId: warriorId, slot: 'weapon3' });

    await setHeritage(19);
    expect((await equip3(sword)).json().error.code).toBe('SLOT_LOCKED');

    await setHeritage(20);
    expect((await equip3(hat)).json().error.code).toBe('WRONG_SLOT');
    // Le Mage n'a pas de 3e arme, même au 20e héritage.
    const staff = await item('MAG-AR1-P1-COM');
    expect(
      (
        await post('/api/items/equip', { itemId: staff, characterId: mageId, slot: 'weapon3' })
      ).json().error.code,
    ).toBe('SLOT_LOCKED');

    const swordInWeapon1 = await item('GUE-AR1-P1-RAR');
    await post('/api/items/equip', { itemId: swordInWeapon1, characterId: warriorId });
    let response = await equip3(sword);
    expect(response.statusCode, response.body).toBe(200);
    let save = response.json() as SaveDto;
    expect(save.items.find((i) => i.id === sword)).toMatchObject({ slot: 'weapon3' });
    // L'épée de l'Arme 1 reste en place.
    expect(save.items.find((i) => i.id === swordInWeapon1)).toMatchObject({ slot: 'weapon1' });

    // Un bouclier remplace l'épée de la 3e arme.
    save = (await equip3(shield)).json();
    expect(save.items.find((i) => i.id === shield)).toMatchObject({
      equippedBy: warriorId,
      slot: 'weapon3',
    });
    expect(save.items.find((i) => i.id === sword)).toMatchObject({ equippedBy: null });

    // Repasser sous 20 héritages (debug) libère la 3e arme.
    save = (await setHeritage(5)).json();
    expect(save.items.find((i) => i.id === shield)).toMatchObject({ equippedBy: null });

    // Un combat avec la 3e arme se lance (ses stats comptent).
    await setHeritage(20);
    await equip3(shield);
    response = await post('/api/combat/start', { floor: 1 });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('Archimage : 4e active (position 5) et deux fusions par active, chacune payée', async () => {
    await ctx.prisma.character.update({
      where: { id: mageId },
      data: { level: 60, bestLevel: 60 },
    });
    await ctx.prisma.save.update({
      where: { id: saveId },
      data: { unlockedElements: ['neutral', 'earth', 'fire', 'water'] },
    });
    await ctx.prisma.building.create({ data: { saveId, buildingId: 'tour_alchimie', level: 1 } });
    const cost = fusionCost(1, 3);
    await ctx.prisma.save.update({ where: { id: saveId }, data: { gold: BigInt(cost.gold) } });
    await ctx.prisma.resourceStock.create({
      data: { saveId, resourceId: 'ether', amount: cost.ether },
    });
    const deck = [
      { position: 0, skillId: 'MAG-A01-FEU', fusionElement: 'earth', fusionElement2: 'water' },
      { position: 1, skillId: 'MAG-A02-NEU', fusionElement: 'fire', fusionElement2: null },
      { position: 2, skillId: 'MAG-A03-NEU', fusionElement: null },
      { position: 5, skillId: 'MAG-A04-NEU', fusionElement: null },
    ];
    const setDeck = () => post('/api/characters/deck', { characterId: mageId, deck });

    await setHeritage(19);
    // 19 héritages : la double fusion (1er emplacement) est refusée avant la 4e active.
    expect((await setDeck()).json().error.code).toBe('FUSION_LOCKED');

    await setHeritage(20);
    const response = await setDeck();
    expect(response.statusCode, response.body).toBe(200);
    const save = response.json() as SaveDto;
    // Trois éléments fusionnés : trois fusions payées.
    expect(save.gold).toBe(0);
    expect(save.resources.ether ?? 0).toBe(0);
    const skills = save.characters[0]!.skills;
    expect(skills.find((s) => s.position === 0)).toMatchObject({
      fusionElement: 'earth',
      fusionElement2: 'water',
    });
    expect(skills.find((s) => s.position === 5)).toMatchObject({ skillId: 'MAG-A04-NEU' });

    // Le combat reçoit les 4 actives et la double fusion.
    const combat = (await post('/api/combat/start', { floor: 1 })).json();
    const mage = combat.combat.heroes[0];
    expect(mage.skills).toHaveLength(4);
    expect(mage.skills[0]).toMatchObject({ fusion: 'earth', fusion2: 'water' });
    expect(mage.evolution).toBe(2);
  });
});
