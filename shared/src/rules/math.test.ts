import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { excelRound, levelFactor } from './math.ts';

describe('excelRound (ROUND d’Excel)', () => {
  it('arrondit les moitiés en s’éloignant de zéro', () => {
    expect(excelRound(2.5)).toBe(3);
    expect(excelRound(3.5)).toBe(4);
    expect(excelRound(-2.5)).toBe(-3);
    expect(excelRound(0.0005, 3)).toBe(0.001);
  });

  it('corrige le bruit binaire comme Excel', () => {
    expect(excelRound(2.675, 2)).toBe(2.68);
    expect(excelRound(1.005, 2)).toBe(1.01);
  });

  it('accepte un nombre de décimales négatif', () => {
    expect(excelRound(1234, -2)).toBe(1200);
    expect(excelRound(1250, -2)).toBe(1300);
    expect(excelRound(123_456, -3)).toBe(123_000);
    expect(excelRound(805, -1)).toBe(810);
  });
});

describe('levelFactor', () => {
  const curve = gameData.monsters.params.levelCurve;

  it('vaut 5 % au niveau 1 et 100 % au niveau 100', () => {
    expect(levelFactor(1, curve)).toBe(0.05);
    expect(levelFactor(100, curve)).toBe(1);
    expect(levelFactor(110, curve)).toBeGreaterThan(1);
  });

  it('reproduit la colonne « Facteur de niveau » du bestiaire (niveaux 1 à 110)', () => {
    for (const row of gameData.rewards.levels) {
      expect(levelFactor(row.level, curve), `niveau ${row.level}`).toBeCloseTo(row.levelFactor, 12);
    }
  });

  it('utilise la même courbe pour les équipements et les héros', () => {
    expect(gameData.equipment.params.levelCurve).toEqual(curve);
    expect(gameData.stats.character.levelCurve).toEqual(curve);
  });
});
