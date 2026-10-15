import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import {
  RELICS,
  RELIC_RULES,
  eggDamageBonus,
  relicBonus,
  relicById,
  relicOfMonster,
} from '../rules/relics.ts';
import { createRng } from '../rules/random.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { combatRewards } from './rewards.ts';
import { createCombat, endHeroTurn } from './engine.ts';
import { heroCombatStats, type HeroSetup } from './setup.ts';
import type { CombatEvent, CombatState } from './types.ts';

const hero = (classId: 'warrior' | 'mage' | 'ranger', i = 0): HeroSetup => ({
  characterId: `c${i}`,
  classId,
  level: 50,
  heritageCount: 0,
  equipment: [],
  deck: starterDeckFor(gameData, classId),
});

describe('catalogue des reliques', () => {
  it('une relique par boss, un œuf par dragon (les wyvernes sont des boss)', () => {
    const bosses = gameData.monsters.monsters.filter((m) => m.rank === 'boss');
    const dragons = gameData.monsters.monsters.filter((m) => m.rank === 'dragon');
    expect(bosses).toHaveLength(20);
    expect(dragons).toHaveLength(10);
    for (const b of bosses) expect(relicOfMonster(b.id)?.kind).toBe('relic');
    for (const d of dragons) expect(relicOfMonster(d.id)?.kind).toBe('egg');
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(30);
    expect(relicOfMonster(gameData.monsters.monsters.find((m) => m.rank === 'normal')!.id)).toBe(
      undefined,
    );
  });

  it('les exemples de l’utilisateur', () => {
    const byName = (name: string) => RELICS.find((r) => r.name === name)!;
    expect(byName('Épice').effect).toEqual({ dodge: 0.1 });
    expect(byName('Arbre-Monde').effect).toEqual({ stats: { vitality: 0.1 } });
    expect(byName('Pierre ancestrale').effect).toEqual({ taunt: 0.3 });
    expect(byName('Œuf de dragon de feu').effect).toEqual({ element: 'fire' });
  });

  it('les effets se cumulent (multijoueur : doublons compris)', () => {
    const epice = RELICS.find((r) => r.name === 'Épice')!.id;
    expect(relicBonus([epice, epice, epice]).dodge).toBeCloseTo(0.3);
    const ancestral = RELICS.find((r) => r.name === 'Pierre ancestrale')!.id;
    expect(relicBonus([ancestral, ancestral, ancestral, ancestral]).taunt).toBe(
      RELIC_RULES.maxTaunt,
    );
    expect(relicBonus(['inconnue']).dodge).toBe(0);
  });

  it('œuf de feu : +20 % aux compétences de Feu, +10 % aux fusions qui contiennent le Feu', () => {
    const bonus = relicBonus(['OEUF-FEU']);
    expect(eggDamageBonus(bonus, 'fire', null)).toBeCloseTo(0.2);
    expect(eggDamageBonus(bonus, 'fire', 'water')).toBeCloseTo(0.3);
    expect(eggDamageBonus(bonus, 'water', 'fire')).toBeCloseTo(0.1);
    expect(eggDamageBonus(bonus, 'water', null)).toBe(0);
    expect(relicById('OEUF-FEU')!.name).toBe('Œuf de dragon de feu');
  });
});

describe('reliques en combat', () => {
  const id = (name: string) => RELICS.find((r) => r.name === name)!.id;

  it('les statistiques de toute l’équipe montent', () => {
    const plain = heroCombatStats(gameData, hero('mage'), {});
    const boosted = heroCombatStats(
      gameData,
      hero('mage'),
      {},
      relicBonus([id('Arbre-Monde'), id('Épice'), id("Lampe de l'Ifrit")]),
    );
    expect(boosted.maxHp).toBeGreaterThan(plain.maxHp * 1.08);
    expect(boosted.magic).toBeGreaterThan(plain.magic * 1.08);
    expect(boosted.dodgeBonus).toBeCloseTo(plain.dodgeBonus + 0.1);
  });

  const fight = (relics: string[], seed = 1) =>
    createCombat(gameData, {
      floor: 10,
      heroes: [hero('warrior', 0), hero('mage', 1), hero('ranger', 2)],
      tower: {},
      seed,
      relics,
    });

  it('Égide de l’archange : bouclier au début du combat', () => {
    const { state } = fight([id("Égide de l'archange")]);
    for (const h of state.heroes) expect(h.shield).toBe(Math.round(h.stats.maxHp * 0.1));
    expect(state.relics).toEqual([id("Égide de l'archange")]);
  });

  it('Pierre ancestrale : les attaques mono-cible visent souvent le Guerrier', () => {
    const targetsOfMonsters = (relics: string[]) => {
      const hits: string[] = [];
      for (let seed = 1; seed <= 15; seed++) {
        let state: CombatState = fight(relics, seed).state;
        for (let r = 0; r < 4 && state.phase === 'heroes'; r++) {
          const result = endHeroTurn(gameData, state);
          for (const e of result.events)
            if (e.type === 'action' && e.actorId.startsWith('m')) hits.push(...e.targetIds);
          state = result.state;
        }
      }
      return hits.filter((t) => t === 'h0').length / hits.length;
    };
    const withTaunt = targetsOfMonsters([id('Pierre ancestrale')]);
    expect(withTaunt).toBeGreaterThan(targetsOfMonsters([]) + 0.1);
  });

  it("Ankh d'Anubis : le premier héros vaincu se relève une fois", () => {
    let state = fight([id("Ankh d'Anubis")]).state;
    state.heroes[1]!.hp = 1;
    const events: CombatEvent[] = [];
    for (let r = 0; r < 30 && state.phase === 'heroes'; r++) {
      const result = endHeroTurn(gameData, state);
      events.push(...result.events);
      state = result.state;
    }
    const revives = events.filter((e) => e.type === 'revive');
    expect(revives).toHaveLength(1);
    expect(state.revivesLeft).toBe(0);
  });

  it('Trésor du chef gobelin : +15 % d’or', () => {
    const state = fight([id('Trésor du chef gobelin')]).state;
    state.killed = [{ monsterId: 'MON-001', level: 10, xp: 100, gold: 1000 }];
    expect(combatRewards(gameData.monsters, state).gold).toBe(1150);
    expect(combatRewards(gameData.monsters, { ...state, relics: [] }).gold).toBe(1000);
  });

  it('les combats enregistrés avant les reliques continuent de marcher', () => {
    const state = fight([]).state;
    delete state.relics;
    delete state.revivesLeft;
    state.rng = createRng(3);
    expect(() => endHeroTurn(gameData, state)).not.toThrow();
  });
});
