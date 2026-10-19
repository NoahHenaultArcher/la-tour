import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { activeAlteration, applyAlteration } from './alterations.ts';
import type { AttackResult } from './damage.ts';
import { createCombat, playAutoTurn } from './engine.ts';
import type { HeroSetup } from './setup.ts';
import { skillById } from './skills.ts';
import type { CombatEvent, CombatState } from './types.ts';
import { UNIQUE, UNIQUE_PASSIVE_RULES as R, uniqueDamageTakenFactor } from './uniqueData.ts';
import {
  uniqueAttackBonus,
  uniqueHealingFactor,
  uniquesAfterAttack,
  uniquesAfterSkill,
  uniquesAtRoundStart,
  uniquesBeforeDeaths,
  uniquesBeforeSkill,
  uniquesOnStrike,
  uniquesWhenDodged,
  uniquesWhenHit,
} from './uniques.ts';

type ClassId = 'warrior' | 'mage' | 'ranger';

const heroSetup = (classId: ClassId, uniques: string[]): HeroSetup => ({
  characterId: 'c0',
  classId,
  level: 30,
  heritageCount: 0,
  equipment: [],
  deck: starterDeckFor(gameData, classId),
  uniques,
});

/** Combat de l'étage 21 (3 monstres) avec un héros qui porte ces Uniques. */
function setup(classId: ClassId, uniques: string[], seed = 1) {
  const { state, events } = createCombat(gameData, {
    floor: 21,
    heroes: [heroSetup(classId, uniques)],
    tower: {},
    seed,
  });
  // Tests déterministes : les monstres ne résistent pas aux altérations.
  for (const m of state.monsters) m.stats.statusResistance = 0;
  const ctx = { data: gameData, state, events: [] as CombatEvent[] };
  return { state, ctx, startEvents: events, hero: state.heroes[0]!, monster: state.monsters[0]! };
}

const skill = (id: string) => skillById(gameData, id);
const hit = (amount: number, critical = false): AttackResult => ({
  amount,
  critical,
  missed: false,
});
const announced = (events: CombatEvent[], itemId: string) =>
  events.filter((e) => e.type === 'uniquePassive' && e.itemId === itemId).length;

/** Part des essais (sur des combats différents) où le passif s'annonce. */
function triggerRate(
  classId: ClassId,
  id: string,
  run: (s: ReturnType<typeof setup>) => void,
  runs = 1500,
): number {
  let count = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const s = setup(classId, [id], seed);
    run(s);
    if (announced(s.ctx.events, id) > 0) count++;
  }
  return count / runs;
}

describe('les 30 passifs d’Uniques sont branchés', () => {
  it('chaque Unique du catalogue a son passif dans le moteur', () => {
    const wired = new Set<string>(Object.values(UNIQUE));
    expect(wired.size).toBe(30);
    for (const u of gameData.equipment.uniques) expect(wired.has(u.id), u.name).toBe(true);
  });

  it('un combat complet avec tous les Uniques de chaque classe se joue sans erreur', () => {
    for (const classId of ['warrior', 'mage', 'ranger'] as const) {
      const prefix = { warrior: 'GUE', mage: 'MAG', ranger: 'TIR' }[classId];
      const all = Object.values(UNIQUE).filter((id) => id.startsWith(prefix));
      let { state } = createCombat(gameData, {
        floor: 20,
        heroes: [{ ...heroSetup(classId, all), level: 60 }],
        tower: {},
        seed: 7,
      });
      for (let i = 0; i < 200 && state.phase === 'heroes'; i++)
        state = playAutoTurn(gameData, state).state;
      expect(state.phase, classId).not.toBe('heroes');
    }
  });
});

describe('Guerrier', () => {
  it('Volonté inflexible : +15 % de Résistance 3 manches, premier contrôle ignoré', () => {
    const { hero, monster, ctx } = setup('warrior', [UNIQUE.willpower]);
    const buff = hero.modifiers.find((m) => m.key === `unique:${UNIQUE.willpower}`)!;
    expect(buff.stats).toEqual({ resistance: 0.15 });
    expect(buff.remaining).toBe(3);
    applyAlteration(gameData, monster, hero, 'assomme', ctx.events);
    expect(hero.skipNextTurn).toBe(false);
    applyAlteration(gameData, monster, hero, 'assomme', ctx.events);
    expect(hero.skipNextTurn).toBe(true);
  });

  it('Peau de granit : −12 % de dégâts physiques ; +20 % d’Armure après 3 attaques subies', () => {
    const { hero, monster, ctx } = setup('warrior', [UNIQUE.graniteSkin]);
    expect(uniqueDamageTakenFactor(hero, 1)).toBeCloseTo(0.88);
    expect(uniqueDamageTakenFactor(hero, 0)).toBe(1);
    uniquesWhenHit(ctx, monster, hero, 10);
    uniquesWhenHit(ctx, monster, hero, 10);
    expect(hero.modifiers.some((m) => m.key === `unique:${UNIQUE.graniteSkin}`)).toBe(false);
    uniquesWhenHit(ctx, monster, hero, 10);
    const armor = hero.modifiers.find((m) => m.key === `unique:${UNIQUE.graniteSkin}`)!;
    expect(armor.stats).toEqual({ armor: 0.2 });
    expect(armor.remaining).toBe(2);
  });

  it('Sillage de braise : 25 % par manche de brûler un ennemi', () => {
    const rate = triggerRate('warrior', UNIQUE.emberTrail, (s) => uniquesAtRoundStart(s.ctx));
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.3);
    const { ctx, state } = setup('warrior', [UNIQUE.emberTrail], 3);
    for (let i = 0; i < 30; i++) uniquesAtRoundStart(ctx);
    expect(state.monsters.some((m) => activeAlteration(m, 'brulure'))).toBe(true);
  });

  it('Piétinement givré : 30 % par manche de refroidir un ennemi', () => {
    const rate = triggerRate('warrior', UNIQUE.frostStomp, (s) => uniquesAtRoundStart(s.ctx));
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.35);
  });

  it('Serment de sang : 5 % (10 % sous la moitié des PV) des dégâts, 10 % des PV max par manche', () => {
    const { hero, monster, ctx, state } = setup('warrior', [UNIQUE.bloodOath]);
    hero.hp = Math.round(hero.stats.maxHp * 0.8);
    const before = hero.hp;
    uniquesOnStrike(ctx, hero, monster, skill('GUE-A01-NEU'), hit(100));
    expect(hero.hp - before).toBe(5);
    hero.hp = 1;
    uniquesOnStrike(ctx, hero, monster, skill('GUE-A01-NEU'), hit(1_000_000));
    const cap = Math.round(hero.stats.maxHp * 0.1);
    expect(hero.hp).toBeGreaterThanOrEqual(cap - 5);
    expect(hero.hp).toBeLessThanOrEqual(cap + 1);
    const capped = hero.hp;
    uniquesOnStrike(ctx, hero, monster, skill('GUE-A01-NEU'), hit(1_000_000));
    expect(hero.hp).toBe(capped);
    state.round += 1;
    uniquesOnStrike(ctx, hero, monster, skill('GUE-A01-NEU'), hit(1_000_000));
    expect(hero.hp).toBeGreaterThan(capped);
  });

  it('Morsure corrosive : chaque coup pose Corrosion (4 piles max)', () => {
    const { hero, monster, ctx } = setup('warrior', [UNIQUE.corrosiveBite]);
    for (let i = 0; i < 6; i++) uniquesOnStrike(ctx, hero, monster, skill('GUE-A01-NEU'), hit(10));
    expect(activeAlteration(monster, 'corrosion')).toMatchObject({ stacks: 4, remaining: 3 });
  });

  it('Marée apaisante : manche 1 puis toutes les 4 manches, purifie et soigne 3 %', () => {
    const { hero, ctx, state, startEvents } = setup('warrior', [UNIQUE.soothingTide]);
    expect(announced(startEvents, UNIQUE.soothingTide)).toBe(1);
    hero.hp = 100;
    applyAlteration(gameData, null, hero, 'poison', ctx.events);
    state.round = 2;
    uniquesAtRoundStart(ctx);
    expect(hero.alterations).toHaveLength(1);
    state.round = 5;
    uniquesAtRoundStart(ctx);
    expect(hero.alterations).toHaveLength(0);
    expect(hero.hp).toBe(100 + Math.round(hero.stats.maxHp * 0.03));
  });

  it('Conduction : 15 % de rebondir sur un second ennemi pour 50 % des dégâts', () => {
    const shares: number[] = [];
    const rate = triggerRate('warrior', UNIQUE.conduction, (s) =>
      uniquesAfterAttack(
        s.ctx,
        s.hero,
        skill('GUE-A01-NEU'),
        { targets: [s.monster], aliveBefore: s.state.monsters },
        (target, share) => {
          expect(target).not.toBe(s.monster);
          shares.push(share);
          return hit(1);
        },
      ),
    );
    expect(rate).toBeGreaterThan(0.11);
    expect(rate).toBeLessThan(0.19);
    expect(new Set(shares)).toEqual(new Set([0.5]));
  });

  it('Moisson funeste : un ennemi vaincu → soin de 8 % et Corruption aux autres, 1 fois par manche', () => {
    const { hero, ctx, state } = setup('warrior', [UNIQUE.grimHarvest]);
    const [first, ...others] = state.monsters;
    const aliveBefore = [...state.monsters];
    first!.hp = 0;
    hero.hp = 100;
    const after = () =>
      uniquesAfterAttack(ctx, hero, skill('GUE-A01-NEU'), { targets: [first!], aliveBefore }, () =>
        hit(1),
      );
    after();
    expect(hero.hp).toBe(100 + Math.round(hero.stats.maxHp * 0.08));
    for (const m of others) expect(activeAlteration(m, 'corruption')).toBeDefined();
    after();
    expect(hero.hp).toBe(100 + Math.round(hero.stats.maxHp * 0.08));
  });

  it('Dernier rempart : sous 30 % des PV, bouclier de 20 % et purification, 1 fois par combat', () => {
    const { hero, ctx } = setup('warrior', [UNIQUE.lastBastion]);
    applyAlteration(gameData, null, hero, 'poison', ctx.events);
    hero.hp = Math.floor(hero.stats.maxHp * 0.25);
    uniquesBeforeDeaths(ctx);
    expect(hero.shield).toBe(Math.round(hero.stats.maxHp * 0.2));
    expect(hero.shieldRemaining).toBe(3);
    expect(hero.alterations).toHaveLength(0);
    hero.shield = 0;
    uniquesBeforeDeaths(ctx);
    expect(hero.shield).toBe(0);
  });
});

describe('Mage', () => {
  it('Pensée vive : 15 % de réduire la recharge de 1, jamais sous 1, ultimes exclues', () => {
    const rate = triggerRate('mage', UNIQUE.quickThought, (s) => {
      const slot = { skillId: 'MAG-A03-NEU', cooldown: 2, remaining: 2 };
      uniquesAfterSkill(s.ctx, s.hero, slot, skill(slot.skillId), { overloadReady: false });
      if (announced(s.ctx.events, UNIQUE.quickThought)) expect(slot.remaining).toBe(1);
    });
    expect(rate).toBeGreaterThan(0.11);
    expect(rate).toBeLessThan(0.19);
    expect(
      triggerRate(
        'mage',
        UNIQUE.quickThought,
        (s) => {
          const ultimate = { skillId: 'MAG-A07-NEU', cooldown: 3, remaining: 3 };
          uniquesAfterSkill(s.ctx, s.hero, ultimate, skill(ultimate.skillId), {
            overloadReady: false,
          });
          const quick = { skillId: 'MAG-A01-NEU', cooldown: 1, remaining: 1 };
          uniquesAfterSkill(s.ctx, s.hero, quick, skill('MAG-A01-NEU'), { overloadReady: false });
        },
        300,
      ),
    ).toBe(0);
  });

  it('Manteau de givre : 20 % de refroidir un attaquant physique', () => {
    const physical = triggerRate('mage', UNIQUE.frostMantle, (s) => {
      s.monster.attackType = 'physical';
      uniquesWhenHit(s.ctx, s.monster, s.hero, 10);
    });
    expect(physical).toBeGreaterThan(0.16);
    expect(physical).toBeLessThan(0.24);
    const magical = triggerRate(
      'mage',
      UNIQUE.frostMantle,
      (s) => {
        s.monster.attackType = 'magical';
        uniquesWhenHit(s.ctx, s.monster, s.hero, 10);
      },
      300,
    );
    expect(magical).toBe(0);
  });

  it('Tempête naissante : un éclair toutes les 3 compétences, 1 fois par manche', () => {
    const { hero, ctx, state } = setup('mage', [UNIQUE.risingStorm]);
    const slot = hero.skills[0]!;
    const cast = () =>
      uniquesAfterSkill(ctx, hero, slot, skill(slot.skillId), { overloadReady: false });
    const bolts = () =>
      ctx.events.filter((e) => e.type === 'damage' && e.sourceId === hero.id).length;
    cast();
    cast();
    expect(bolts()).toBe(0);
    cast();
    expect(bolts()).toBe(1);
    cast();
    cast();
    cast();
    expect(bolts()).toBe(1);
    state.round += 1;
    cast();
    expect(bolts()).toBe(2);
  });

  it('Marée montante : 25 % par manche de réduire une recharge (hors ultime)', () => {
    const rate = triggerRate('mage', UNIQUE.risingTide, (s) => {
      for (const slot of s.hero.skills) slot.remaining = 2;
      uniquesAtRoundStart(s.ctx);
    });
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.3);
  });

  it('Regard maudit : 25 % de poser Corruption', () => {
    const rate = triggerRate('mage', UNIQUE.cursedGaze, (s) => {
      uniquesOnStrike(s.ctx, s.hero, s.monster, skill('MAG-A01-NEU'), hit(10));
      if (activeAlteration(s.monster, 'corruption'))
        s.ctx.events.push({ type: 'uniquePassive', actorId: s.hero.id, itemId: UNIQUE.cursedGaze });
    });
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.3);
  });

  it('Transmutation : 10 % des dégâts magiques en bouclier, plafonné à 15 % des PV max', () => {
    const { hero, monster, ctx } = setup('mage', [UNIQUE.transmutation]);
    uniquesOnStrike(ctx, hero, monster, skill('MAG-A01-NEU'), hit(200));
    expect(hero.shield).toBe(20);
    uniquesOnStrike(ctx, hero, monster, skill('MAG-A01-NEU'), hit(10_000_000));
    expect(hero.shield).toBe(Math.round(hero.stats.maxHp * 0.15));
  });

  it('Pierre de garde : −12 % de dégâts reçus au-dessus de la moitié des PV', () => {
    const { hero } = setup('mage', [UNIQUE.guardStone]);
    expect(uniqueDamageTakenFactor(hero, 0)).toBeCloseTo(0.88);
    hero.hp = Math.floor(hero.stats.maxHp * 0.4);
    expect(uniqueDamageTakenFactor(hero, 0)).toBe(1);
  });

  it('Flamme vive : les compétences de Feu brûlent 2 manches (10 % de la Magie)', () => {
    const { hero, monster, ctx } = setup('mage', [UNIQUE.livingFlame]);
    uniquesOnStrike(ctx, hero, monster, skill('MAG-A01-NEU'), hit(10));
    expect(activeAlteration(monster, 'brulure')).toBeUndefined();
    uniquesOnStrike(ctx, hero, monster, skill('MAG-A01-FEU'), hit(10));
    const burn = activeAlteration(monster, 'brulure')!;
    expect(burn.remaining).toBe(2);
    expect(burn.damagePerStack).toBeCloseTo(0.1 * hero.stats.magic);
  });

  it('Surcharge arcanique : 5 charges, puis +60 % sur la compétence suivante', () => {
    const { hero, ctx } = setup('mage', [UNIQUE.arcaneOverload]);
    const slot = hero.skills[0]!;
    const cast = () => {
      const before = uniquesBeforeSkill(hero);
      const bonus = uniqueAttackBonus(ctx, hero).damageBonus;
      uniquesAfterSkill(ctx, hero, slot, skill(slot.skillId), before);
      return bonus;
    };
    const bonuses = Array.from({ length: 7 }, cast);
    expect(bonuses).toEqual([0, 0, 0, 0, 0, R.arcaneOverload.bonus, 0]);
    expect(hero.counters.overload).toBe(1);
  });

  it('Alternance : soins +15 % aux manches impaires, dégâts +15 % aux manches paires', () => {
    const { hero, ctx, state } = setup('mage', [UNIQUE.alternation]);
    state.round = 1;
    expect(uniqueHealingFactor(state, hero)).toBeCloseTo(1.15);
    expect(uniqueAttackBonus(ctx, hero).damageBonus).toBe(0);
    state.round = 2;
    expect(uniqueHealingFactor(state, hero)).toBe(1);
    expect(uniqueAttackBonus(ctx, hero).damageBonus).toBeCloseTo(0.15);
  });
});

describe('Tireur', () => {
  it('Regard perçant : la première attaque de chaque manche ne peut pas être esquivée', () => {
    const { hero, ctx, state } = setup('ranger', [UNIQUE.piercingGaze]);
    expect(uniqueAttackBonus(ctx, hero).neverMiss).toBe(true);
    expect(uniqueAttackBonus(ctx, hero).neverMiss).toBe(false);
    state.round += 1;
    expect(uniqueAttackBonus(ctx, hero).neverMiss).toBe(true);
  });

  it('Brume protectrice : +5 % d’Esquive par attaque esquivée, 3 piles', () => {
    const { hero, ctx } = setup('ranger', [UNIQUE.protectiveMist]);
    for (let i = 0; i < 4; i++) uniquesWhenDodged(ctx, hero);
    const mist = hero.modifiers.find((m) => m.key === `unique:${UNIQUE.protectiveMist}`)!;
    expect(mist).toMatchObject({ dodge: 0.05, stacks: 3, remaining: 2 });
  });

  it('Traque givrée : les attaques sans recharge posent Froid', () => {
    const { hero, monster, ctx } = setup('ranger', [UNIQUE.frostTracking]);
    const withCooldown = gameData.skills.catalog.find(
      (s) => s.id.startsWith('TIR') && s.family === 'attack' && (s.cooldown ?? 0) > 0,
    )!;
    uniquesOnStrike(ctx, hero, monster, withCooldown, hit(10));
    expect(activeAlteration(monster, 'froid')).toBeUndefined();
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(10));
    expect(activeAlteration(monster, 'froid')).toMatchObject({ stacks: 1, remaining: 2 });
  });

  it('Pas d’éclair : première attaque du combat +30 % et 30 % d’étourdir', () => {
    const { hero, ctx } = setup('ranger', [UNIQUE.lightningStep]);
    expect(uniqueAttackBonus(ctx, hero)).toMatchObject({ damageBonus: 0.3, stunChance: 0.3 });
    expect(uniqueAttackBonus(ctx, hero)).toMatchObject({ damageBonus: 0, stunChance: 0 });
  });

  it('Racines protectrices : 10 % des dégâts subis en bouclier, plafonné à 10 % des PV max', () => {
    const { hero, monster, ctx } = setup('ranger', [UNIQUE.protectiveRoots]);
    uniquesWhenHit(ctx, monster, hero, 100);
    expect(hero.shield).toBe(10);
    expect(hero.shieldRemaining).toBe(2);
    uniquesWhenHit(ctx, monster, hero, 10_000_000);
    expect(hero.shield).toBe(Math.round(hero.stats.maxHp * 0.1));
  });

  it('Pointes incendiaires : un critique brûle (15 % des dégâts du coup, 2 manches)', () => {
    const { hero, monster, ctx } = setup('ranger', [UNIQUE.incendiaryTips]);
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(1000));
    expect(activeAlteration(monster, 'brulure')).toBeUndefined();
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(1000, true));
    expect(activeAlteration(monster, 'brulure')).toMatchObject({
      damagePerStack: 150,
      remaining: 2,
    });
  });

  it('Dernier souffle : un coup mortel laisse à 1 PV (+20 % d’Esquive), 1 fois par combat', () => {
    const { hero, ctx } = setup('ranger', [UNIQUE.lastBreath]);
    hero.hp = 0;
    uniquesBeforeDeaths(ctx);
    expect(hero.hp).toBe(1);
    expect(hero.modifiers.find((m) => m.key === `unique:${UNIQUE.lastBreath}`)).toMatchObject({
      dodge: 0.2,
      remaining: 2,
    });
    hero.hp = 0;
    uniquesBeforeDeaths(ctx);
    expect(hero.hp).toBe(0);
  });

  it('Dernier souffle en combat : le héros survit au coup fatal', () => {
    const { hero, ctx } = setup('ranger', [UNIQUE.lastBreath]);
    const state: CombatState = ctx.state;
    hero.hp = 1;
    hero.stats.dodgeBonus = -1; // touché à coup sûr
    let current = state;
    for (let i = 0; i < 3 && current.phase === 'heroes'; i++)
      current = playAutoTurn(gameData, current).state;
    expect(current.heroes[0]!.counters.lastBreathUsed).toBe(1);
  });

  it('Fioles corrosives : 25 % de Corrosion (−6 % d’Armure), 3 piles au plus', () => {
    const rate = triggerRate('ranger', UNIQUE.corrosiveVials, (s) => {
      uniquesOnStrike(s.ctx, s.hero, s.monster, skill('TIR-A01-NEU'), hit(10));
      if (activeAlteration(s.monster, 'corrosion'))
        s.ctx.events.push({
          type: 'uniquePassive',
          actorId: s.hero.id,
          itemId: UNIQUE.corrosiveVials,
        });
    });
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.3);
    const { hero, monster, ctx } = setup('ranger', [UNIQUE.corrosiveVials]);
    for (let i = 0; i < 100; i++)
      uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(10));
    expect(activeAlteration(monster, 'corrosion')).toMatchObject({ stacks: 3, value: 0.06 });
  });

  it('Pluie de flèches : 20 % de tirer 2 flèches à 30 % sur d’autres cibles, 1 fois par manche', () => {
    let strikes = 0;
    const rate = triggerRate('ranger', UNIQUE.arrowRain, (s) =>
      uniquesAfterAttack(
        s.ctx,
        s.hero,
        skill('TIR-A01-NEU'),
        { targets: [s.monster], aliveBefore: s.state.monsters },
        (target, share) => {
          expect(target).not.toBe(s.monster);
          expect(share).toBe(0.3);
          strikes++;
          return hit(1);
        },
      ),
    );
    expect(rate).toBeGreaterThan(0.16);
    expect(rate).toBeLessThan(0.24);
    expect(strikes % 2).toBe(0);
    // Une seule pluie par manche.
    const { ctx, hero, monster, state } = setup('ranger', [UNIQUE.arrowRain]);
    for (let i = 0; i < 100; i++)
      uniquesAfterAttack(
        ctx,
        hero,
        skill('TIR-A01-NEU'),
        { targets: [monster], aliveBefore: state.monsters },
        () => hit(1),
      );
    expect(announced(ctx.events, UNIQUE.arrowRain)).toBe(1);
  });

  it('Flèches spectrales : un critique traverse (40 % sur un second ennemi), 1 fois par manche', () => {
    const { hero, monster, ctx, state } = setup('ranger', [UNIQUE.spectralArrows]);
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(1000, true));
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(1000, true));
    const pierced = ctx.events.filter((e) => e.type === 'damage' && e.targetId !== monster.id);
    expect(pierced).toHaveLength(1);
    expect(pierced[0]).toMatchObject({ amount: 400 });
    state.round += 1;
    uniquesOnStrike(ctx, hero, monster, skill('TIR-A01-NEU'), hit(1000));
    expect(ctx.events.filter((e) => e.type === 'damage')).toHaveLength(1);
  });
});
