import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { createCombat, endHeroTurn, performHeroAction } from './engine.ts';
import { isCamouflaged } from './evolution.ts';
import type { HeroSetup } from './setup.ts';
import type { CombatEvent, CombatState } from './types.ts';

const hero = (
  classId: 'warrior' | 'mage' | 'ranger',
  heritageCount: number,
  i = 0,
  deck = starterDeckFor(gameData, classId),
): HeroSetup => ({
  characterId: `c${i}`,
  classId,
  level: 30,
  heritageCount,
  equipment: [],
  deck,
});

const fight = (heroes: HeroSetup[], seed: number, floor = 3) =>
  createCombat(gameData, { floor, heroes, tower: {}, seed });

/** Joue `rounds` manches où le héros h0 lance sa première compétence sur le premier monstre. */
function play(state: CombatState, rounds: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (let r = 0; r < rounds && state.phase === 'heroes'; r++) {
    const round = state.round;
    while (state.phase === 'heroes' && state.round === round && state.actionsLeft > 0) {
      const target = state.monsters.find((m) => m.hp > 0);
      const result = performHeroAction(gameData, state, {
        heroId: 'h0',
        skillId: state.heroes[0]!.skills[0]!.skillId,
        targetId: target?.id,
      });
      events.push(...result.events);
      state = result.state;
    }
  }
  return events;
}

describe('Arbalétier : deuxième attaque', () => {
  const secondAttacks = (heritageCount: number) => {
    let seconds = 0;
    let actions = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const events = play(fight([hero('ranger', heritageCount)], seed).state, 3);
      actions += events.filter((e) => e.type === 'action' && e.actorId === 'h0').length;
      seconds += events.filter((e) => e.type === 'secondAttack').length;
    }
    return seconds / actions;
  };

  it('environ 15 % des attaques sont portées deux fois', () => {
    const rate = secondAttacks(10);
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.25);
  });

  it('jamais avant le 10e héritage', () => {
    expect(secondAttacks(9)).toBe(0);
  });

  it('la deuxième attaque frappe vraiment', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const events = play(fight([hero('ranger', 10)], seed).state, 2);
      const index = events.findIndex((e) => e.type === 'secondAttack');
      if (index < 0) continue;
      const next = events.slice(index + 1).find((e) => e.type === 'damage' || e.type === 'miss');
      expect(next).toBeDefined();
      expect(next).toMatchObject({ sourceId: 'h0' });
      return;
    }
    throw new Error('aucune deuxième attaque sur 30 combats');
  });
});

describe('Tireur magique : camouflage', () => {
  const hitsOn = (events: CombatEvent[], id: string) =>
    events.filter((e) => e.type === 'damage' && e.targetId === id && e.cause === 'attack');

  it('inciblable pendant les 3 premières manches du combat, zones comprises', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let state = fight([hero('ranger', 20)], seed, 9).state; // dragon : souffle sur toute l'équipe
      const early: CombatEvent[] = [];
      while (state.phase === 'heroes' && state.round <= 3) {
        expect(isCamouflaged(state, state.heroes[0]!)).toBe(true);
        const result = endHeroTurn(gameData, state);
        early.push(...result.events);
        state = result.state;
        if (state.round > 3) break;
      }
      // Les attaques de la 4e manche peuvent être dans le dernier lot : on ne garde que les manches 1 à 3.
      const cut = early.findIndex((e) => e.type === 'round' && e.round === 4);
      const firstRounds = cut < 0 ? early : early.slice(0, cut);
      expect(hitsOn(firstRounds, 'h0')).toHaveLength(0);
      expect(firstRounds.some((e) => e.type === 'noTarget')).toBe(true);
      expect(isCamouflaged(state, state.heroes[0]!)).toBe(false);
    }
  });

  it('les autres héros restent visés, et le camouflage n’existe pas avant le 20e héritage', () => {
    let targeted = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = fight([hero('ranger', 20, 0), hero('warrior', 20, 1)], seed);
      const events = endHeroTurn(gameData, state).events;
      expect(hitsOn(events, 'h0')).toHaveLength(0);
      targeted += hitsOn(events, 'h1').length;
      expect(isCamouflaged(state, state.heroes[1]!)).toBe(false);
    }
    expect(targeted).toBeGreaterThan(0);
    const { state } = fight([hero('ranger', 19)], 1);
    expect(isCamouflaged(state, state.heroes[0]!)).toBe(false);
  });
});

describe('Archimage en combat', () => {
  const fireAttacks = gameData.skills.catalog.filter(
    (s) => s.classId === 'mage' && s.family === 'attack' && s.element === 'fire' && !s.ultimate,
  );
  const passives = starterDeckFor(gameData, 'mage').filter((s) => s.position >= 3);

  it('4 compétences actives, la 4e (position 5) jouable', () => {
    const deck = [
      ...fireAttacks.slice(0, 3).map((s, position) => ({ position, skillId: s.id })),
      { position: 5, skillId: fireAttacks[3]!.id },
      ...passives,
    ];
    const { state } = fight([hero('mage', 20, 0, deck)], 1);
    const mage = state.heroes[0]!;
    expect(mage.skills.map((s) => s.skillId)).toEqual(
      [...fireAttacks.slice(0, 4)].map((s) => s.id),
    );
    expect(mage.passives).toHaveLength(passives.length);
    const result = performHeroAction(gameData, state, {
      heroId: 'h0',
      skillId: fireAttacks[3]!.id,
      targetId: state.monsters[0]!.id,
    });
    expect(result.events.some((e) => e.type === 'action' && e.skillId === fireAttacks[3]!.id)).toBe(
      true,
    );
  });

  it('double fusion : deux fois ×1,10 et les effets des deux fusions', () => {
    const skill = fireAttacks[0]!;
    const damageWith = (fusionElement: 'water' | null, fusionElement2: 'earth' | null) => {
      const deck = [{ position: 0, skillId: skill.id, fusionElement, fusionElement2 }, ...passives];
      const { state } = fight([hero('mage', 20, 0, deck)], 7);
      // Monstre très résistant aux altérations : seule la puissance compte.
      const target = state.monsters[0]!;
      target.stats.statusResistance = 1;
      const result = performHeroAction(gameData, state, {
        heroId: 'h0',
        skillId: skill.id,
        targetId: target.id,
      });
      const slot = result.state.heroes[0]!.skills[0]!;
      return { slot, events: result.events };
    };
    const single = damageWith('water', null);
    const double = damageWith('water', 'earth');
    expect(single.slot.fusion2 ?? null).toBeNull();
    expect(double.slot).toMatchObject({ fusion: 'water', fusion2: 'earth' });
    // Même graine : le premier coup de la double fusion frappe plus fort (×1,10 de plus).
    const firstHit = (events: CombatEvent[]) =>
      events.find((e) => e.type === 'damage' && e.sourceId === 'h0');
    const a = firstHit(single.events);
    const b = firstHit(double.events);
    expect(a?.type === 'damage' && b?.type === 'damage').toBe(true);
    if (a?.type === 'damage' && b?.type === 'damage') expect(b.amount).toBeGreaterThan(a.amount);
    // Sans 1re fusion, la 2e est ignorée.
    expect(damageWith(null, 'earth').slot.fusion2 ?? null).toBeNull();
  });
});
