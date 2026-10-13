import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { normalMonsterGold, normalMonsterXp } from './monsters.ts';
import {
  MAX_HERO_LEVEL,
  addXp,
  cumulativeXp,
  levelGapXpFactor,
  referenceItemPrice,
  xpShare,
  xpToNextLevel,
} from './rewards.ts';

const { monsters, rewards } = gameData;

describe('courbes d’XP et d’or (onglet Récompenses, niveaux 1 à 110)', () => {
  it('XP et or d’un monstre Normal', () => {
    for (const row of rewards.levels) {
      expect(normalMonsterXp(monsters, row.level), `XP niv. ${row.level}`).toBe(
        row.xpPerNormalMonster,
      );
      expect(normalMonsterGold(monsters, row.level), `or niv. ${row.level}`).toBe(
        row.goldPerNormalMonster,
      );
    }
  });

  it('XP pour passer au niveau suivant et XP cumulée', () => {
    for (const row of rewards.levels) {
      expect(xpToNextLevel(monsters, row.level), `niv. ${row.level}`).toBe(row.xpToNextLevel);
      if (row.cumulativeXp !== null)
        expect(cumulativeXp(monsters, row.level), `cumul niv. ${row.level}`).toBe(row.cumulativeXp);
    }
  });

  it('prix de référence des objets par rareté', () => {
    for (const row of rewards.levels) {
      for (const [rarity, price] of Object.entries(row.itemPrices)) {
        expect(referenceItemPrice(monsters, row.level, rarity as keyof typeof row.itemPrices)).toBe(
          price,
        );
      }
    }
  });

  it('le niveau maximum des héros est 100', () => {
    expect(MAX_HERO_LEVEL).toBe(100);
    expect(rewards.levels.find((l) => l.level === 99)!.xpToNextLevel).not.toBeNull();
    expect(rewards.levels.find((l) => l.level === 100)!.xpToNextLevel).toBeNull();
  });
});

describe('gain d’XP', () => {
  it('fait monter de niveau en reportant le surplus', () => {
    const needed = xpToNextLevel(monsters, 1)!;
    expect(addXp(monsters, { level: 1, xp: 0 }, needed - 1)).toEqual({
      level: 1,
      xp: needed - 1,
      levelsGained: 0,
    });
    expect(addXp(monsters, { level: 1, xp: 0 }, needed + 5)).toEqual({
      level: 2,
      xp: 5,
      levelsGained: 1,
    });
  });

  it('peut faire passer plusieurs niveaux d’un coup', () => {
    const total = cumulativeXp(monsters, 10);
    expect(addXp(monsters, { level: 1, xp: 0 }, total)).toEqual({
      level: 10,
      xp: 0,
      levelsGained: 9,
    });
  });

  it('s’arrête au niveau 100', () => {
    expect(addXp(monsters, { level: 99, xp: 0 }, 10_000_000)).toEqual({
      level: 100,
      xp: 0,
      levelsGained: 1,
    });
    expect(addXp(monsters, { level: 100, xp: 0 }, 5000)).toEqual({
      level: 100,
      xp: 0,
      levelsGained: 0,
    });
  });
});

describe('partage et écart de niveau', () => {
  it('partage l’XP : 100 % / 75 % / 50 %', () => {
    expect(xpShare(1)).toBe(1);
    expect(xpShare(2)).toBe(0.75);
    expect(xpShare(3)).toBe(0.5);
    expect(() => xpShare(4)).toThrow();
  });

  it('module l’XP selon l’écart de niveau, entre 25 % et 150 %', () => {
    expect(levelGapXpFactor(monsters, 50, 50)).toBe(1);
    expect(levelGapXpFactor(monsters, 53, 50)).toBeCloseTo(1.3, 12);
    expect(levelGapXpFactor(monsters, 80, 50)).toBe(1.5);
    expect(levelGapXpFactor(monsters, 10, 50)).toBe(0.25);
  });
});
