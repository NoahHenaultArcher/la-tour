import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { activePositionsOf, newFusionCount, validateDeck, type DeckSlot } from './deck.ts';
import {
  camouflageRounds,
  evolutionOf,
  evolutionTier,
  hasThirdWeapon,
  nextEvolution,
  secondAttackChance,
} from './evolution.ts';
import { heroStats } from './heroes.ts';
import { starterDeckFor } from './skills.ts';

describe('paliers d’évolution', () => {
  it('1re évolution au 10e héritage, 2e au 20e', () => {
    expect(evolutionTier(0)).toBe(0);
    expect(evolutionTier(9)).toBe(0);
    expect(evolutionTier(10)).toBe(1);
    expect(evolutionTier(19)).toBe(1);
    expect(evolutionTier(20)).toBe(2);
    expect(evolutionTier(45)).toBe(2);
    expect(nextEvolution(7)).toEqual({ tier: 1, heritages: 10, missing: 3 });
    expect(nextEvolution(12)).toEqual({ tier: 2, heritages: 20, missing: 8 });
    expect(nextEvolution(20)).toBeNull();
  });

  it('une évolution par classe et par palier', () => {
    expect(evolutionOf('mage', 0)).toBeNull();
    expect(evolutionOf('mage', 1)).toBe('arcanist');
    expect(evolutionOf('mage', 2)).toBe('archmage');
    expect(evolutionOf('warrior', 1)).toBe('swordsman');
    expect(evolutionOf('warrior', 2)).toBe('weaponMaster');
    expect(evolutionOf('ranger', 1)).toBe('crossbowman');
    expect(evolutionOf('ranger', 2)).toBe('arcaneArcher');
  });

  it('la 2e évolution garde le bonus de la 1re', () => {
    expect(secondAttackChance('ranger', 0)).toBe(0);
    expect(secondAttackChance('ranger', 1)).toBe(0.15);
    expect(secondAttackChance('ranger', 2)).toBe(0.15);
    expect(secondAttackChance('mage', 2)).toBe(0);
    expect(camouflageRounds('ranger', 1)).toBe(0);
    expect(camouflageRounds('ranger', 2)).toBe(3);
    expect(hasThirdWeapon('warrior', 1)).toBe(false);
    expect(hasThirdWeapon('warrior', 2)).toBe(true);
    expect(hasThirdWeapon('mage', 2)).toBe(false);
  });
});

describe('bonus de stats', () => {
  const stats = (classId: 'warrior' | 'mage' | 'ranger', heritageCount: number) =>
    heroStats(gameData.stats, { classId, level: 50, heritageCount, equipment: [] });
  /** Même héros sans évolution : on retire le seul effet de l'héritage (+25 % par héritage). */
  const withoutEvolution = (classId: 'warrior' | 'mage' | 'ranger', heritageCount: number) => {
    const base = stats(classId, 0);
    const factor = 1 + 0.25 * heritageCount;
    return { magic: base.magic * factor, strength: base.strength * factor };
  };

  it('Mage arcaniste : Magie +10 %', () => {
    expect(stats('mage', 10).magic).toBeCloseTo(withoutEvolution('mage', 10).magic * 1.1, -1);
    expect(stats('mage', 9).magic).toBeCloseTo(withoutEvolution('mage', 9).magic, -1);
    expect(stats('mage', 20).magic).toBeCloseTo(withoutEvolution('mage', 20).magic * 1.1, -1);
  });

  it('Épéiste : Force +10 % et Pénétration +0,15', () => {
    expect(stats('warrior', 10).strength).toBeCloseTo(
      withoutEvolution('warrior', 10).strength * 1.1,
      -1,
    );
    expect(stats('warrior', 10).penetration - stats('warrior', 9).penetration).toBeCloseTo(0.15);
    // Les autres classes n'en profitent pas.
    expect(stats('ranger', 10).penetration).toBeCloseTo(stats('ranger', 0).penetration);
  });
});

describe('deck de l’Archimage', () => {
  const unlockedElements = ['neutral', 'earth', 'fire', 'wind', 'water'] as const;
  const check = (deck: DeckSlot[], heritageCount: number, alchemyLevel = 1) =>
    validateDeck(gameData, {
      classId: 'mage',
      level: 100,
      unlockedElements: [...unlockedElements],
      alchemyLevel,
      heritageCount,
      deck,
    });
  const attack = (n: number) =>
    gameData.skills.catalog.filter(
      (s) => s.classId === 'mage' && s.family === 'attack' && s.element === 'fire' && !s.ultimate,
    )[n]!;
  const starter = starterDeckFor(gameData, 'mage');
  const passives = starter.filter((s) => s.position >= 3);

  it('4e active en position 5 seulement pour l’Archimage', () => {
    const deck: DeckSlot[] = [
      { position: 0, skillId: attack(0).id },
      { position: 1, skillId: attack(1).id },
      { position: 2, skillId: attack(2).id },
      { position: 5, skillId: attack(3).id },
      ...passives,
    ];
    expect(check(deck, 20)).toBeNull();
    expect(check(deck, 19)).toBe('INVALID_DECK');
    expect(activePositionsOf('mage', 20)).toEqual([0, 1, 2, 5]);
    expect(activePositionsOf('mage', 19)).toEqual([0, 1, 2]);
    expect(activePositionsOf('warrior', 20)).toEqual([0, 1, 2]);
  });

  it('deux fusions par active, sans la limite de la Tour d’alchimie', () => {
    const deck: DeckSlot[] = [
      { position: 0, skillId: attack(0).id, fusionElement: 'water', fusionElement2: 'earth' },
      { position: 1, skillId: attack(1).id, fusionElement: 'wind', fusionElement2: 'water' },
      { position: 2, skillId: attack(2).id, fusionElement: 'earth' },
      ...passives,
    ];
    // Tour d'alchimie niveau 1 : une seule fusion normalement.
    expect(check(deck, 20, 1)).toBeNull();
    expect(check(deck, 19, 5)).toBe('FUSION_LOCKED');
    // Deuxième fusion : différente de la première, et jamais sans première.
    expect(
      check(
        [
          { position: 0, skillId: attack(0).id, fusionElement: 'water', fusionElement2: 'water' },
          ...passives,
        ],
        20,
      ),
    ).toBe('FUSION_LOCKED');
    expect(
      check(
        [
          { position: 0, skillId: attack(0).id, fusionElement: null, fusionElement2: 'water' },
          ...passives,
        ],
        20,
      ),
    ).toBe('FUSION_LOCKED');
    // Il faut toujours la Tour d'alchimie.
    expect(check(deck, 20, 0)).toBe('FUSION_LOCKED');
  });

  it('chaque élément fusionné se paie', () => {
    const before: DeckSlot[] = [{ position: 0, skillId: attack(0).id, fusionElement: 'water' }];
    const after: DeckSlot[] = [
      { position: 0, skillId: attack(0).id, fusionElement: 'water', fusionElement2: 'earth' },
      { position: 1, skillId: attack(1).id, fusionElement: 'wind', fusionElement2: 'water' },
    ];
    expect(newFusionCount(before, after)).toBe(3);
    expect(newFusionCount(after, after)).toBe(0);
  });
});
