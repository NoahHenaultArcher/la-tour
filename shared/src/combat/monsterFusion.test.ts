import { describe, expect, it } from 'vitest';
import { ABYSS, ALPHA } from '../balance.ts';
import { ELEMENT_IDS, type ElementId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { abyssFloorType } from '../rules/abyss.ts';
import { createRng } from '../rules/random.ts';
import { starterDeckFor } from '../rules/skills.ts';
import type { AttackSpec } from './damage.ts';
import { createCombat, endHeroTurn } from './engine.ts';
import { fusionTriggerChance, monsterFusionAttack, rollMonsterFusion } from './monsterFusion.ts';
import { buildAbyssWaves, createMonsterCombatant } from './setup.ts';
import type { CombatEvent } from './types.ts';

const normalId = gameData.monsters.monsters.find((m) => m.rank === 'normal')!.id;

/** Combat de l'Abysse avec 3 héros niveau 100 très robustes (les effets ne doivent pas les tuer). */
function trio() {
  const hero = (classId: 'warrior' | 'mage' | 'ranger', i: number) => ({
    characterId: `c${i}`,
    classId,
    level: 100,
    heritageCount: 20,
    equipment: [],
    deck: starterDeckFor(gameData, classId),
  });
  return createCombat(gameData, {
    floor: 1,
    mode: 'abyss',
    heroes: [hero('warrior', 0), hero('mage', 1), hero('ranger', 2)],
    tower: {},
    seed: 5,
  }).state;
}

const baseSpec = (element: ElementId): AttackSpec => ({
  power: gameData.monsters.params.combat.monsterAveragePower,
  element,
  elementalShare: 0.5,
  armorIgnore: 0,
  resistanceIgnore: 0,
  neverMiss: true,
  bonusCrit: 0,
});

describe('fusions ennemies : qui les reçoit', () => {
  const spawns = Array.from({ length: 300 }, (_, seed) =>
    buildAbyssWaves(gameData, 1, createRng(seed)),
  ).flat(2);

  it('une part des monstres de l’Abysse ; toujours les alphas « Fusionné »', () => {
    const share = spawns.filter((s) => s.fusion).length / spawns.length;
    expect(share).toBeGreaterThan(ABYSS.fusionChance * 0.6);
    expect(share).toBeLessThan(ABYSS.fusionChance * 1.8);
    const fused = spawns.filter((s) => s.alpha === 'fused');
    expect(fused.length).toBeGreaterThan(0);
    expect(fused.every((s) => s.fusion)).toBe(true);
    expect(new Set(spawns.map((s) => s.fusion).filter(Boolean)).size).toBe(ELEMENT_IDS.length);
  });

  it('jamais les dragons', () => {
    const lair = Array.from({ length: 200 }, (_, i) => i + 1).find(
      (f) => abyssFloorType(f) === 'dragon',
    )!;
    for (let seed = 0; seed < 50; seed++)
      expect(buildAbyssWaves(gameData, lair, createRng(seed))[0]![0]!.fusion).toBeUndefined();
  });

  it('la tour et la chasse n’en ont pas', () => {
    const plain = createMonsterCombatant(gameData, { monsterId: normalId, level: 50 }, 'm0');
    expect(plain.fusion).toBeNull();
    expect(fusionTriggerChance(plain)).toBe(0);
  });
});

describe('fusions ennemies : déclenchement', () => {
  it('environ 30 % des attaques, 60 % pour un alpha « Fusionné »', () => {
    const rate = (alpha?: 'fused') => {
      const m = createMonsterCombatant(
        gameData,
        {
          monsterId: normalId,
          level: 110,
          abyssFloor: 1,
          fusion: 'fire',
          ...(alpha ? { alpha } : {}),
        },
        'm0',
      );
      const rng = createRng(9);
      let count = 0;
      for (let i = 0; i < 4000; i++) if (rollMonsterFusion(rng, m)) count++;
      return count / 4000;
    };
    expect(rate()).toBeCloseTo(ABYSS.fusionTrigger, 1);
    expect(rate('fused')).toBeCloseTo(ALPHA.fusedTrigger, 1);
  });
});

describe('fusions ennemies : effets', () => {
  it('les 55 fusions fonctionnent contre les héros, sans erreur', () => {
    let tested = 0;
    for (const [i, element] of ELEMENT_IDS.entries()) {
      for (const second of ELEMENT_IDS.slice(i)) {
        for (let seed = 0; seed < 6; seed++) {
          const state = trio();
          state.rng = createRng(seed * 31 + i);
          const m = createMonsterCombatant(
            gameData,
            { monsterId: normalId, level: 110, abyssFloor: 1, fusion: second },
            'mx',
          );
          m.element = element;
          state.monsters.push(m);
          const events: CombatEvent[] = [];
          const hits = monsterFusionAttack(
            { data: gameData, state, events },
            m,
            state.heroes[0]!,
            baseSpec(element),
          );
          expect(events[0]).toEqual({ type: 'fusion', actorId: 'mx', element, fusion: second });
          expect(hits.length).toBeGreaterThan(0);
          for (const h of state.heroes) expect(Number.isFinite(h.hp)).toBe(true);
        }
        tested++;
      }
    }
    expect(tested).toBe(55);
  });

  it('Brasier brûle les héros ; Vapeur frappe toute l’équipe d’un malus', () => {
    const run = (element: ElementId, second: ElementId, seed: number) => {
      const state = trio();
      state.rng = createRng(seed);
      // Après le camouflage du Tireur magique (20 héritages) : toute l'équipe est visable.
      state.round = 4;
      const m = createMonsterCombatant(
        gameData,
        { monsterId: normalId, level: 110, abyssFloor: 1, fusion: second },
        'mx',
      );
      m.element = element;
      const events: CombatEvent[] = [];
      monsterFusionAttack(
        { data: gameData, state, events },
        m,
        state.heroes[0]!,
        baseSpec(element),
      );
      return { state, events };
    };
    const burns = Array.from({ length: 40 }, (_, seed) => run('fire', 'fire', seed)).filter(
      ({ state }) => state.heroes[0]!.alterations.some((a) => a.id === 'brulure'),
    );
    expect(burns.length).toBeGreaterThan(5);
    const brasier = burns[0]!.state.heroes[0]!.alterations.find((a) => a.id === 'brulure')!;
    expect(brasier.value).toBe(0.12);

    const { state } = run('fire', 'water', 1);
    for (const h of state.heroes)
      expect(
        h.modifiers.some((mod) => mod.key === 'fusion:fire+water' && mod.kind === 'debuff'),
      ).toBe(true);
  });

  it("en combat, un monstre de l'Abysse finit par déclencher sa fusion", () => {
    let state = trio();
    const m = state.monsters[0]!;
    m.fusion = 'ice';
    state = { ...state, monsters: [m] };
    const fusions: CombatEvent[] = [];
    // Les héros passent leur tour : seul le monstre agit, manche après manche.
    for (let round = 0; round < 30 && state.phase === 'heroes'; round++) {
      const result = endHeroTurn(gameData, state);
      fusions.push(...result.events.filter((e) => e.type === 'fusion'));
      state = result.state;
    }
    expect(fusions.length).toBeGreaterThan(0);
  });
});

it('le monstre garde la fusion dans son état (affichage)', () => {
  const spawn = { monsterId: normalId, level: 110, abyssFloor: 1, fusion: 'acid' as const };
  expect(createMonsterCombatant(gameData, spawn, 'm0').fusion).toBe('acid');
});
