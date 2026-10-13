import { describe, expect, it } from 'vitest';
import type { ClassId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { starterDeckFor } from '../rules/skills.ts';
import {
  CombatError,
  createCombat,
  passHeroActions,
  performHeroAction,
  playAutoForHero,
  winCurrentWave,
  withdrawHero,
} from './engine.ts';
import { participantRewards } from './rewards.ts';
import type { HeroSetup } from './setup.ts';
import type { CombatState } from './types.ts';

const data = gameData;

function hero(classId: ClassId, level = 30): HeroSetup {
  return {
    characterId: `char-${classId}`,
    classId,
    level,
    heritageCount: 0,
    equipment: [],
    deck: starterDeckFor(data, classId),
  };
}

const multi = (mode: 'tower' | 'hunt' = 'tower', floor = 1) =>
  createCombat(data, {
    floor,
    mode,
    heroes: [hero('warrior'), hero('mage')],
    tower: {},
    seed: 3,
    multiplayer: true,
  }).state;

const target = (state: CombatState) => state.monsters.find((m) => m.hp > 0)!.id;

describe('combat multijoueur', () => {
  it('chaque héros a ses 3 actions ; un héros sans action ne peut plus agir', () => {
    let state = multi();
    expect(state.heroActions).toEqual({ h0: 3, h1: 3 });
    expect(state.actionsLeft).toBe(6);
    const round = state.round;
    for (let i = 0; i < 3 && state.round === round && state.waveIndex === 0; i++) {
      state = performHeroAction(data, state, {
        heroId: 'h0',
        skillId: 'GUE-A01-NEU',
        targetId: target(state),
      }).state;
    }
    if (state.round === round && state.waveIndex === 0) {
      expect(state.heroActions!.h0).toBe(0);
      expect(() =>
        performHeroAction(data, state, {
          heroId: 'h0',
          skillId: 'GUE-A01-NEU',
          targetId: target(state),
        }),
      ).toThrow(CombatError);
      // Le Mage joue encore ; quand il passe, la manche se termine.
      state = passHeroActions(data, state, 'h1').state;
      expect(state.round === round + 1 || state.phase !== 'heroes').toBe(true);
    }
  });

  it('un joueur absent : son héros joue seul, uniquement des compétences sans recharge', () => {
    const state = multi();
    const result = playAutoForHero(data, state, 'h1', { noCooldownOnly: true });
    const actions = result.events.filter((e) => e.type === 'action' && e.actorId === 'h1');
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      if (action.type !== 'action' || !action.skillId) continue;
      const skill = data.skills.catalog.find((s) => s.id === action.skillId)!;
      expect(skill.cooldown).toBe(0);
    }
    if (result.state.round === state.round) expect(result.state.heroActions!.h1).toBe(0);
  });

  it('zone de chasse : un héros se retire, la chasse continue ; le dernier qui part la termine', () => {
    let state = multi('hunt', 5);
    state = winCurrentWave(data, state).state;
    const killed = state.killed.length;
    expect(state.killed.every((k) => k.sharedBy === 2)).toBe(true);
    state = withdrawHero(data, state, 'h1').state;
    expect(state.heroes.map((h) => h.id)).toEqual(['h0']);
    expect(state.phase).toBe('heroes');
    state = winCurrentWave(data, state).state;
    expect(state.killed.slice(killed).every((k) => k.sharedBy === 1)).toBe(true);
    state = withdrawHero(data, state, 'h0').state;
    expect(state.phase).toBe('retreat');
    expect(() => withdrawHero(data, multi(), 'h0')).toThrow('NOT_A_HUNT');
  });

  it('récompenses : XP et or partagés selon les héros présents à chaque monstre', () => {
    const kill = { monsterId: 'MON-001', level: 10, xp: 100, gold: 40 };
    const solo = participantRewards(data.monsters, [{ ...kill, sharedBy: 1 }], 10);
    const duo = participantRewards(data.monsters, [{ ...kill, sharedBy: 2 }], 10);
    const trio = participantRewards(data.monsters, [{ ...kill, sharedBy: 3 }], 10);
    expect(solo.gold).toBe(40);
    expect(duo.gold).toBe(30);
    expect(trio.gold).toBe(20);
    expect(duo.xp).toBe(Math.floor(solo.xp * 0.75));
    expect(participantRewards(data.monsters, [{ ...kill, sharedBy: 1 }], 10, 0.1).gold).toBe(44);
  });
});
