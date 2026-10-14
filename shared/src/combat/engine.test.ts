import { describe, expect, it } from 'vitest';
import { DRAGON_RULES } from '../balance.ts';
import type { ClassId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { createRng } from '../rules/random.ts';
import { starterDeckFor } from '../rules/skills.ts';
import {
  ALTERATION_RULES,
  applyAlteration,
  resolveTurnStart,
  tickAlterations,
  tryApplyAlteration,
} from './alterations.ts';
import {
  CombatError,
  createCombat,
  endHeroTurn,
  forfeitCombat,
  performHeroAction,
  playAutoTurn,
  winCurrentWave,
} from './engine.ts';
import { combatRewards } from './rewards.ts';
import type { HeroSetup } from './setup.ts';
import {
  ATTACK_EFFECTS,
  FUSION_EFFECTS,
  PASSIVE_EFFECTS,
  SUPPORT_EFFECTS,
  fusionKey,
} from './effects.ts';
import type { CombatEvent, CombatState, Combatant } from './types.ts';

const data = gameData;

function hero(classId: ClassId, level = 1, deck = starterDeckFor(data, classId)): HeroSetup {
  return { characterId: `char-${classId}`, classId, level, heritageCount: 0, equipment: [], deck };
}

function start(floor: number, heroes: HeroSetup[] = [hero('warrior')], seed = 42) {
  return createCombat(data, { floor, heroes, tower: {}, seed });
}

const living = (state: CombatState) => state.monsters.filter((m) => m.hp > 0);

describe('composition des étages', () => {
  it('étage normal : 3 vagues de 3 monstres de la zone, au niveau de l’étage', () => {
    const { state } = start(3);
    expect(state.floorType).toBe('normal');
    expect(state.waves.map((w) => w.length)).toEqual([3, 3, 3]);
    const zoneIds = data.monsters.monsters
      .filter((m) => m.zoneFloor === 5 && m.rank !== 'boss')
      .map((m) => m.id);
    for (const spawn of state.waves.flat()) {
      expect(zoneIds).toContain(spawn.monsterId);
      expect(spawn.level).toBe(3);
    }
  });

  it('étage de boss : 4 vagues normales puis le boss et 2 escortes', () => {
    const { state } = start(5);
    expect(state.waves.map((w) => w.length)).toEqual([3, 3, 3, 3, 3]);
    const last = state.waves[4]!;
    const ranks = last.map((s) => data.monsters.monsters.find((m) => m.id === s.monsterId)!.rank);
    expect(ranks.filter((r) => r === 'boss')).toHaveLength(1);
    expect(
      state.waves
        .slice(0, 4)
        .flat()
        .some((s) => s.monsterId === 'MON-004'),
    ).toBe(false);
  });

  it('étage du dragon : le dragon seul', () => {
    const { state } = start(9);
    expect(state.waves).toEqual([[{ monsterId: 'MON-005', level: 9 }]]);
  });
});

describe('dragons (phase 9)', () => {
  /** Tanière du Feu, héros plus rapide : la manche 1 commence par le tour des héros. */
  const lair = (seed = 42) => {
    const { state } = start(29, [hero('ranger', 60)], seed);
    const dragon = state.monsters[0]!;
    return { state, dragon };
  };
  /** Événements de la manche jouée (avant l'annonce de la manche suivante). */
  const thisRound = (events: CombatEvent[]) => {
    const next = events.findIndex((e) => e.type === 'round');
    return next === -1 ? events : events.slice(0, next);
  };

  it('agit deux fois par manche', () => {
    const { state, dragon } = lair();
    expect(state.phase).toBe('heroes');
    const { events } = endHeroTurn(data, state);
    const actions = thisRound(events).filter((e) => e.type === 'action' && e.actorId === dragon.id);
    expect(actions).toHaveLength(DRAGON_RULES.actionsPerRound);
  });

  it('sous 66 % de ses PV il appelle des renforts, sous 50 % il entre en furie', () => {
    const { state, dragon } = lair();
    dragon.hp = Math.round(dragon.stats.maxHp * 0.6);
    const first = endHeroTurn(data, state);
    const summons = first.events.filter((e) => e.type === 'summon');
    expect(summons).toHaveLength(1);
    expect(first.state.monsters).toHaveLength(1 + DRAGON_RULES.summonCount);
    expect(first.events.some((e) => e.type === 'enrage')).toBe(false);

    // Sous 33 % : la 2e invocation et la furie arrivent ensemble.
    const fury = first.state.monsters[0]!;
    fury.hp = Math.round(fury.stats.maxHp * 0.3);
    const second = endHeroTurn(data, first.state);
    expect(second.events.some((e) => e.type === 'enrage' && e.targetId === fury.id)).toBe(true);
    expect(second.events.filter((e) => e.type === 'summon')).toHaveLength(1);
    expect(second.state.monsters[0]!.modifiers.some((m) => m.key === 'dragon:fury')).toBe(true);
  });

  it("son souffle inflige à coup sûr l'altération de son élément (Brûlure pour le Feu)", () => {
    let breaths = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { state, dragon } = lair(seed);
      state.round = 3; // manche de souffle
      state.heroes[0]!.stats.statusResistance = 0;
      // Le souffle est la 1re action du dragon : on regarde ce qui suit, jusqu'à sa 2e action.
      const round = thisRound(endHeroTurn(data, state).events);
      const actions = round
        .map((e, i) => (e.type === 'action' && e.actorId === dragon.id ? i : -1))
        .filter((i) => i >= 0);
      const breath = round.slice(actions[0], actions[1]);
      const hit = breath.find(
        (e) => e.type === 'damage' && e.sourceId === dragon.id && e.amount > 0,
      );
      if (!hit) continue;
      breaths++;
      expect(
        breath.some((e) => e.type === 'alteration' && e.alterationId === 'brulure'),
        `graine ${seed}`,
      ).toBe(true);
    }
    expect(breaths).toBeGreaterThan(0);
  });
});

describe('déroulement d’une manche', () => {
  it('le camp à la plus haute Initiative moyenne commence (égalité : héros)', () => {
    const strong = start(1, [hero('ranger', 60)]);
    expect(strong.events.find((e) => e.type === 'round')).toMatchObject({ first: 'hero' });

    const weak = start(60, [hero('warrior', 1)]);
    const round = weak.events.find((e) => e.type === 'round')!;
    expect(round).toMatchObject({ first: 'monster' });
    // Les monstres ont déjà joué avant que le joueur ait la main.
    expect(weak.events.some((e) => e.type === 'action' && e.actorId.startsWith('m'))).toBe(true);
    expect(weak.state.monstersPending).toBe(false);
  });

  it('3 actions par manche pour l’équipe ; une compétence sans recharge peut servir 3 fois', () => {
    let { state } = start(1, [hero('warrior', 30)]);
    expect(state.actionsLeft).toBe(3);
    const target = () => living(state)[0]!.id;
    for (let i = 0; i < 3 && state.round === 1 && state.waveIndex === 0; i++) {
      state = performHeroAction(data, state, {
        heroId: 'h0',
        skillId: 'GUE-A01-NEU',
        targetId: target(),
      }).state;
    }
    expect(state.round).toBeGreaterThan(1);
  });

  it('une compétence à recharge ne se lance qu’une fois par manche', () => {
    const deck = [
      { position: 0, skillId: 'GUE-A05-NEU' }, // Entaille : recharge 1
      { position: 1, skillId: 'GUE-A01-NEU' },
    ];
    let { state } = start(20, [hero('warrior', 1, deck)]);
    // Héros niveau 1 contre l'étage 20 : les monstres jouent d'abord, le héros a la main ensuite.
    state = performHeroAction(data, state, {
      heroId: 'h0',
      skillId: 'GUE-A05-NEU',
      targetId: living(state)[0]!.id,
    }).state;
    expect(() =>
      performHeroAction(data, state, {
        heroId: 'h0',
        skillId: 'GUE-A05-NEU',
        targetId: living(state)[0]!.id,
      }),
    ).toThrow(CombatError);
    expect(state.heroes[0]!.skills[0]!.remaining).toBe(1);
  });

  it('refuse les actions invalides', () => {
    const { state } = start(1);
    const target = living(state)[0]!.id;
    const attempt = (input: Parameters<typeof performHeroAction>[2]) => () =>
      performHeroAction(data, state, input);
    expect(attempt({ heroId: 'h9', skillId: 'GUE-A01-NEU', targetId: target })).toThrow(
      'INVALID_HERO',
    );
    expect(attempt({ heroId: 'h0', skillId: 'MAG-A01-NEU', targetId: target })).toThrow(
      'INVALID_SKILL',
    );
    expect(attempt({ heroId: 'h0', skillId: 'GUE-A01-NEU', targetId: 'm99' })).toThrow(
      'INVALID_TARGET',
    );
    const over = forfeitCombat(data, state).state;
    expect(() =>
      performHeroAction(data, over, { heroId: 'h0', skillId: 'GUE-A01-NEU', targetId: target }),
    ).toThrow('COMBAT_OVER');
  });

  it('passer son tour laisse jouer les monstres puis ouvre une nouvelle manche', () => {
    const { state } = start(2);
    const next = endHeroTurn(data, state);
    // (Plus d'une manche peut passer si le héros est assommé entre-temps.)
    expect(next.state.round).toBeGreaterThan(state.round);
    expect(next.events.some((e) => e.type === 'action' && e.actorId.startsWith('m'))).toBe(true);
  });

  it('est déterministe : même graine, mêmes actions, même résultat', () => {
    const play = () => {
      let { state } = start(4, [hero('mage', 4)], 7);
      while (state.phase === 'heroes') state = playAutoTurn(data, state).state;
      return state;
    };
    expect(play()).toEqual(play());
  });
});

describe('vagues, victoire et défaite', () => {
  it('les PV des héros sont conservés d’une vague à l’autre', () => {
    let { state } = start(1, [hero('warrior', 1)]);
    state.heroes[0]!.hp = 123;
    state = winCurrentWave(data, state).state;
    expect(state.waveIndex).toBe(1);
    expect(state.heroes[0]!.hp).toBeLessThanOrEqual(123);
    expect(state.heroes[0]!.hp).toBeGreaterThan(0);
  });

  it('victoire après la dernière vague ; tous les monstres vaincus sont comptés', () => {
    let { state } = start(5, [hero('warrior', 50)]);
    let events: CombatEvent[] = [];
    while (state.phase === 'heroes') ({ state, events } = winCurrentWave(data, state));
    expect(state.phase).toBe('victory');
    expect(events.at(-1)).toEqual({ type: 'end', outcome: 'victory' });
    expect(state.killed).toHaveLength(15);
    expect(state.killed.some((k) => k.monsterId === 'MON-004')).toBe(true);
  });

  it('défaite quand tous les héros tombent ; abandon possible', () => {
    let { state } = start(40, [hero('mage', 1)]);
    let guard = 0;
    while (state.phase === 'heroes' && guard++ < 200) state = endHeroTurn(data, state).state;
    expect(state.phase).toBe('defeat');
    expect(forfeitCombat(data, start(1).state).state.phase).toBe('defeat');
  });

  it('mode auto : l’IA joue les 3 actions et gagne un étage facile', () => {
    let { state } = start(1, [hero('ranger', 20)]);
    while (state.phase === 'heroes') state = playAutoTurn(data, state).state;
    expect(state.phase).toBe('victory');
  });
});

describe('dégâts et éléments', () => {
  it('l’avantage élémentaire (×1,5) s’applique aux attaques des héros', () => {
    // Eau contre les monstres de Feu (Océan de lave, étage 25).
    let { state } = start(21, [hero('warrior', 60, [{ position: 0, skillId: 'GUE-A01-EAU' }])]);
    const result = performHeroAction(data, state, {
      heroId: 'h0',
      skillId: 'GUE-A01-EAU',
      targetId: living(state)[0]!.id,
    });
    const hit = result.events.find(
      (e) => e.type === 'damage' && e.cause === 'attack' && e.sourceId === 'h0',
    );
    expect(hit).toMatchObject({ elementMultiplier: 1.5 });
    state = result.state;
  });

  it('un héros plus fort inflige plus de dégâts et en subit moins', () => {
    const damageDealt = (level: number) => {
      const { state } = start(10, [hero('warrior', level)], 3);
      const { events } = performHeroAction(data, state, {
        heroId: 'h0',
        skillId: 'GUE-A01-NEU',
        targetId: living(state)[0]!.id,
      });
      return events
        .filter((e) => e.type === 'damage' && e.sourceId === 'h0')
        .reduce((s, e) => s + (e.type === 'damage' ? e.amount : 0), 0);
    };
    expect(damageDealt(40)).toBeGreaterThan(damageDealt(5));
  });
});

describe('altérations', () => {
  /** Un héros et un monstre « propres » (sans les effets de la première manche). */
  const fresh = (): { target: Combatant; source: Combatant } => {
    const { state } = start(1);
    const target = state.heroes[0]!;
    Object.assign(target, {
      hp: target.stats.maxHp,
      alterations: [],
      skipNextTurn: false,
      stunnedThisPhase: false,
      controlImmunity: 0,
      lostLastTurn: false,
    });
    return { target, source: state.monsters[0]! };
  };

  it('chaque altération du bestiaire a une règle', () => {
    for (const alteration of data.monsters.alterations)
      expect(ALTERATION_RULES[alteration.id], alteration.id).toBeDefined();
  });

  it('Saignement : se cumule jusqu’à 3 piles, durée rafraîchie, dégâts en fin de manche', () => {
    const { target, source } = fresh();
    const events: CombatEvent[] = [];
    for (let i = 0; i < 5; i++) applyAlteration(data, source, target, 'saignement', events);
    const bleed = target.alterations.find((a) => a.id === 'saignement')!;
    expect(bleed).toMatchObject({ stacks: 3, remaining: 3 });
    const hp = target.hp;
    tickAlterations(target, events);
    expect(target.hp).toBeLessThan(hp);
    expect(target.alterations.find((a) => a.id === 'saignement')!.remaining).toBe(2);
  });

  it('Froid : à 3 piles, la cible gèle et perd son prochain tour, puis devient immunisée', () => {
    const { target, source } = fresh();
    const events: CombatEvent[] = [];
    for (let i = 0; i < 3; i++) applyAlteration(data, source, target, 'froid', events);
    expect(target.skipNextTurn).toBe(true);
    expect(target.alterations.map((a) => a.id)).toEqual(['gel']);
    resolveTurnStart(data, createRng(1), target, events);
    expect(target.stunnedThisPhase).toBe(true);
    expect(target.controlImmunity).toBeGreaterThan(0);
    tryApplyAlteration(data, createRng(1), source, target, 'assomme', 1, events);
    expect(target.skipNextTurn).toBe(false);
  });

  it('Mouillé retire la Brûlure', () => {
    const { target, source } = fresh();
    const events: CombatEvent[] = [];
    applyAlteration(data, source, target, 'brulure', events);
    applyAlteration(data, source, target, 'mouille', events);
    expect(target.alterations.map((a) => a.id)).toEqual(['mouille']);
  });

  it('la Résistance aux altérations réduit la chance ; les contrôles sont divisés par 2 sur les boss', () => {
    const rate = (isBoss: boolean, statusResistance: number) => {
      let applied = 0;
      for (let seed = 0; seed < 2000; seed++) {
        const { target, source } = fresh();
        target.isBoss = isBoss;
        target.stats.statusResistance = statusResistance;
        tryApplyAlteration(data, createRng(seed), source, target, 'assomme', 1, []);
        if (target.skipNextTurn) applied++;
      }
      return applied / 2000;
    };
    expect(rate(false, 0)).toBe(1);
    expect(rate(false, 0.5)).toBeCloseTo(0.5, 1);
    expect(rate(true, 0)).toBeCloseTo(0.5, 1);
  });
});

describe('effets des compétences', () => {
  it('chaque compétence de base (79) a un effet défini, et chaque fusion (55) aussi', () => {
    for (const base of data.skills.bases) {
      const effect =
        base.family === 'attack'
          ? ATTACK_EFFECTS[base.id]
          : base.family === 'support'
            ? SUPPORT_EFFECTS[base.id]
            : PASSIVE_EFFECTS[base.id];
      expect(effect, `${base.id} ${base.name}`).toBeDefined();
    }
    for (const f of data.skills.fusions) {
      expect(FUSION_EFFECTS[fusionKey(f.element1, f.element2)], f.name).toBeDefined();
    }
    expect(Object.keys(FUSION_EFFECTS)).toHaveLength(data.skills.fusions.length);
  });

  it('les passifs modifient les stats (Peau dure : +8 % de Résistance)', () => {
    const withPassive = start(1, [hero('warrior', 50)]).state.heroes[0]!;
    const without = start(1, [
      hero(
        'warrior',
        50,
        starterDeckFor(data, 'warrior').filter((s) => s.position < 3),
      ),
    ]).state.heroes[0]!;
    expect(withPassive.stats.resistance).toBe(Math.round(without.stats.resistance * 1.08));
  });
});

describe('récompenses', () => {
  it('XP partagée selon le nombre de héros, or pour l’équipe', () => {
    const finish = (heroes: HeroSetup[]) => {
      let { state } = start(2, heroes);
      while (state.phase === 'heroes') state = winCurrentWave(data, state).state;
      return { state, rewards: combatRewards(data.monsters, state) };
    };
    const solo = finish([hero('warrior', 2)]);
    const duo = finish([hero('warrior', 2), hero('mage', 2)]);
    const soloXp = solo.rewards.xp['char-warrior']!;
    expect(soloXp).toBeGreaterThan(0);
    expect(duo.rewards.xp['char-warrior']).toBe(Math.floor(soloXp * 0.75));
    expect(solo.rewards.gold).toBe(solo.state.killed.reduce((s, k) => s + k.gold, 0));
    expect(combatRewards(data.monsters, solo.state, 0.1).gold).toBe(
      Math.floor(solo.rewards.gold * 1.1),
    );
  });
});
