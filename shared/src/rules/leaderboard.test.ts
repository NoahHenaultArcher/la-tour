import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { itemPower, itemStats } from './equipment.ts';
import { LEADERBOARD_SCORE, leaderboardScore } from './leaderboard.ts';

const empty = {
  floorsCleared: 0,
  heritageCount: 0,
  heroLevels: [],
  equipped: [],
  buildingLevels: [],
};

describe('classement', () => {
  it('additionne étages, héritages, niveaux, équipement et bâtiments', () => {
    const item = gameData.equipment.catalog.find((c) => c.rarity === 'epic')!;
    const power = itemPower(gameData.equipment, itemStats(gameData.equipment, item, 3));
    const score = leaderboardScore(gameData.equipment, {
      floorsCleared: 12,
      heritageCount: 1,
      heroLevels: [15, 10],
      equipped: [{ item, upgradeLevel: 3 }],
      buildingLevels: [2, 1, 1],
    });
    expect(score).toEqual({
      floors: 600,
      heritage: 8000,
      heroes: 250,
      equipment: Math.round(power * 10),
      buildings: 80,
      total: 600 + 8000 + 250 + Math.round(power * 10) + 80,
    });
    expect(leaderboardScore(gameData.equipment, empty).total).toBe(0);
  });

  it('un héritage ne fait jamais baisser le score (tour finie, 3 héros niveau 100 → tout à zéro)', () => {
    const before = leaderboardScore(gameData.equipment, {
      ...empty,
      floorsCleared: 100,
      heroLevels: [100, 100, 100],
    });
    const after = leaderboardScore(gameData.equipment, {
      ...empty,
      heritageCount: 1,
      heroLevels: [1, 1, 1],
    });
    expect(after.total).toBeGreaterThanOrEqual(before.total);
    expect(LEADERBOARD_SCORE.size).toBe(10);
  });
});
