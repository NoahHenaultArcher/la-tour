/**
 * Simulation d'équilibrage : un héros seul en mode auto, avec son kit de départ ou un deck complet,
 * sans équipement ou avec l'équipement « attendu » de l'étage.
 * Garantit que le début de partie reste adouci (étages 1 à 10, sans équipement) et protège la
 * difficulté « exigeante » choisie en phase 9 (balance.ts, MONSTER_SCALING et TEAM_SCALING).
 * Le rapport complet se génère avec scripts/balance-report.ts.
 */
import { describe, expect, it } from 'vitest';
import { STAT_POINTS } from '../balance.ts';
import { RARITY_IDS, SLOT_IDS, type ClassId, type RarityId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { itemStats } from '../rules/equipment.ts';
import { addXp } from '../rules/rewards.ts';
import { starterDeckFor } from '../rules/skills.ts';
import { createCombat, playAutoTurn } from './engine.ts';
import { createMonsterCombatant, type HeroSetup } from './setup.ts';
import { combatRewards } from './rewards.ts';
import type { CombatState } from './types.ts';

const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];

function fight(
  classId: ClassId,
  level: number,
  floor: number,
  seed: number,
  deck: HeroSetup['deck'] = starterDeckFor(gameData, classId),
  equipment: HeroSetup['equipment'] = [],
  allocation?: HeroSetup['allocation'],
): CombatState {
  let { state } = createCombat(gameData, {
    floor,
    heroes: [
      {
        characterId: 'c',
        classId,
        level,
        heritageCount: 0,
        equipment,
        deck,
        allocation,
      },
    ],
    tower: {},
    seed,
  });
  while (state.phase === 'heroes') state = playAutoTurn(gameData, state).state;
  return state;
}

function winRate(
  classId: ClassId,
  level: number,
  floor: number,
  runs = 40,
  deck?: HeroSetup['deck'],
  equipment?: HeroSetup['equipment'],
  allocation?: HeroSetup['allocation'],
): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    if (fight(classId, level, floor, seed, deck, equipment, allocation).phase === 'victory') wins++;
  }
  return wins / runs;
}

describe('équilibrage sans équipement (kit de départ, mode auto)', () => {
  for (const classId of CLASSES) {
    it(`${classId} : étages 1 à 4 gagnés presque toujours au niveau de l'étage`, () => {
      for (const floor of [1, 2, 3, 4]) {
        expect(winRate(classId, floor, floor), `étage ${floor}`).toBeGreaterThanOrEqual(0.95);
      }
    });

    it(`${classId} : le premier boss (étage 5) est battu le plus souvent dès le niveau 6`, () => {
      expect(winRate(classId, 6, 5)).toBeGreaterThanOrEqual(0.6);
    });

    it(`${classId} : monte jusqu'à l'étage 10 presque sans échec (début adouci)`, () => {
      let hero = { level: 1, xp: 0 };
      let attempts = 0;
      for (let floor = 1; floor <= 10; floor++) {
        let won = false;
        for (let tries = 1; !won; tries++) {
          expect(tries, `étage ${floor}`).toBeLessThanOrEqual(10);
          attempts++;
          const state = fight(classId, hero.level, floor, floor * 100 + tries);
          const xp = combatRewards(gameData.monsters, state).xp.c ?? 0;
          hero = { ...hero, ...addXp(gameData.monsters, hero, xp) };
          won = state.phase === 'victory';
        }
      }
      expect(attempts).toBeLessThanOrEqual(14);
    });
  }
});

/** Deck complet (phase 7) : une attaque sans recharge, une de zone, une ultime, deux passifs. */
const FULL_DECKS = Object.fromEntries(
  Object.entries({
    warrior: ['GUE-A01-NEU', 'GUE-A04-NEU', 'GUE-A07-NEU', 'GUE-P02', 'GUE-P04'],
    mage: ['MAG-A01-NEU', 'MAG-A03-NEU', 'MAG-A07-NEU', 'MAG-P01', 'MAG-P02'],
    ranger: ['TIR-A02-NEU', 'TIR-A03-NEU', 'TIR-A07-NEU', 'TIR-P01', 'TIR-P07'],
    // Positions 0 à 2 : actives ; 3 et 4 : passives.
  }).map(([classId, ids]) => [classId, ids.map((skillId, position) => ({ position, skillId }))]),
) as Record<ClassId, HeroSetup['deck']>;

/**
 * Équipement « attendu » d'un étage : les 10 objets du palier de l'étage, dans la rareté médiane
 * des boss du biome, améliorés jusqu'au niveau de l'étage (plafond du palier compris).
 */
function expectedEquipment(classId: ClassId, floor: number): HeroSetup['equipment'] {
  const tier = gameData.equipment.tiers.filter((t) => t.unlockFloor <= floor).at(-1)!.tier;
  const biome = gameData.elements.biomes.find((b) => floor >= b.floorMin && floor <= b.floorMax)!;
  const weights = gameData.loot.rarityTables.boss.find((r) => r.biome === biome.id)!.weights;
  let cumulative = 0;
  const rarity =
    RARITY_IDS.filter((r) => r !== 'unique').find((r) => (cumulative += weights[r] ?? 0) >= 0.5) ??
    ('common' as RarityId);
  return SLOT_IDS.map((slot) => {
    const item = gameData.equipment.catalog.find(
      (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
    )!;
    const upgrade = Math.min(Math.max(0, floor - item.baseLevel), item.maxUpgrade);
    return itemStats(gameData.equipment, item, upgrade);
  });
}

/** Deck complet limité aux compétences débloquées au niveau du héros, complété par le kit de départ. */
function deckAt(classId: ClassId, level: number): HeroSetup['deck'] {
  const baseOf = (skillId: string) => {
    const skill = gameData.skills.catalog.find((s) => s.id === skillId)!;
    return gameData.skills.bases.find((b) => b.id === skill.baseId)!;
  };
  const deck = FULL_DECKS[classId].filter((s) => baseOf(s.skillId).requiredLevel <= level);
  for (const slot of starterDeckFor(gameData, classId)) {
    const free = (slot.position < 3 ? [0, 1, 2] : [3, 4]).find(
      (p) => !deck.some((d) => d.position === p),
    );
    const known = deck.some((d) => baseOf(d.skillId).id === baseOf(slot.skillId).id);
    if (free !== undefined && !known) deck.push({ position: free, skillId: slot.skillId });
  }
  return deck;
}

/** Points de stats d'un joueur type : moitié Vitalité, moitié stat d'attaque. */
function allocationAt(classId: ClassId, level: number): HeroSetup['allocation'] {
  const points = Math.max(0, level - 1) * STAT_POINTS.perLevel;
  const vitality = Math.floor(points / 2);
  const attack = points - vitality;
  return {
    vitality,
    strength: classId === 'mage' ? 0 : attack,
    magic: classId === 'mage' ? attack : 0,
    resistance: 0,
    agility: 0,
  };
}

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe('difficulté exigeante (deck complet, mode auto)', () => {
  const runs = 12;
  for (const classId of CLASSES) {
    const geared = (floor: number, level = floor) =>
      winRate(
        classId,
        level,
        floor,
        runs,
        deckAt(classId, level),
        expectedEquipment(classId, floor),
        allocationAt(classId, level),
      );

    it(`${classId} : avec l'équipement attendu, un boss au niveau de l'étage se gagne le plus souvent`, () => {
      expect(average([30, 60, 90].map((floor) => geared(floor)))).toBeGreaterThanOrEqual(0.75);
    });

    it(`${classId} : sans équipement, les boss du milieu et de la fin de la tour deviennent durs`, () => {
      const naked = [40, 75, 95].map((floor) =>
        winRate(
          classId,
          floor,
          floor,
          runs,
          deckAt(classId, floor),
          [],
          allocationAt(classId, floor),
        ),
      );
      expect(average(naked)).toBeLessThanOrEqual(0.35);
    });

    it(`${classId} : avoir 5 niveaux de retard se paie`, () => {
      const floors = [25, 65, 85];
      const atLevel = average(floors.map((floor) => geared(floor)));
      const behind = average(floors.map((floor) => geared(floor, floor - 5)));
      expect(behind).toBeLessThan(atLevel);
    });
  }
});

describe('tanières des dragons (2 actions, furie, souffle élémentaire, renforts)', () => {
  const solo = (floor: number, equipped: boolean) =>
    average(
      CLASSES.map((classId) =>
        winRate(
          classId,
          floor,
          floor,
          12,
          deckAt(classId, floor),
          equipped ? expectedEquipment(classId, floor) : [],
          allocationAt(classId, floor),
        ),
      ),
    );

  it("équipé, on gagne le plus souvent, mais plus à coup sûr (ce n'est plus un sac à PV)", () => {
    const rate = average([29, 69, 99].map((floor) => solo(floor, true)));
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThanOrEqual(0.95);
  });

  it('sans équipement, un dragon gagne le plus souvent', () => {
    expect(average([39, 79].map((floor) => solo(floor, false)))).toBeLessThanOrEqual(0.4);
  });
});

/** Équipe de 3 héros en solo (3 actions pour l'équipe), même profil que les tests ci-dessus. */
function trioWinRate(floor: number, equipped: boolean, runs = 12): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    let { state } = createCombat(gameData, {
      floor,
      heroes: CLASSES.map((classId, i) => ({
        characterId: `h${i}`,
        classId,
        level: floor,
        heritageCount: 0,
        equipment: equipped ? expectedEquipment(classId, floor) : [],
        deck: deckAt(classId, floor),
        allocation: allocationAt(classId, floor),
      })),
      tower: {},
      seed: floor * 131 + seed,
    });
    while (state.phase === 'heroes') state = playAutoTurn(gameData, state).state;
    if (state.phase === 'victory') wins++;
  }
  return wins / runs;
}

describe("taille de l'équipe", () => {
  it('3 héros équipés gagnent la plupart des boss, mais pas sans équipement', () => {
    expect(average([25, 65, 100].map((floor) => trioWinRate(floor, true)))).toBeGreaterThanOrEqual(
      0.75,
    );
    expect(average([45, 80, 100].map((floor) => trioWinRate(floor, false)))).toBeLessThanOrEqual(
      0.35,
    );
  });

  it('les PV des monstres valent ×1, ×2 et ×3 avec 1, 2 et 3 héros', () => {
    const spawn = { monsterId: gameData.monsters.monsters[0]!.id, level: 40 };
    const hp = [1, 2, 3].map(
      (heroes) => createMonsterCombatant(gameData, spawn, 'm', heroes).stats.maxHp,
    );
    expect(hp[1]! / hp[0]!).toBeCloseTo(2, 2);
    expect(hp[2]! / hp[0]!).toBeCloseTo(3, 2);
  });
});
