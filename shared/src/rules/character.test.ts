import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { baseInitiative, heritageMultiplier, maxHp } from './character.ts';

const stats = gameData.stats;

describe('héros', () => {
  it('Initiative de base au niveau 100 : Guerrier 70, Mage 80, Tireur 100', () => {
    expect(baseInitiative(stats, 'warrior', 100)).toBe(70);
    expect(baseInitiative(stats, 'mage', 100)).toBe(80);
    expect(baseInitiative(stats, 'ranger', 100)).toBe(100);
  });

  it('l’Initiative suit la courbe de niveau (5 % au niveau 1)', () => {
    expect(baseInitiative(stats, 'ranger', 1)).toBe(5);
    expect(baseInitiative(stats, 'warrior', 1)).toBe(4); // 3,5 arrondi à 4
    expect(baseInitiative(stats, 'mage', 50)).toBeLessThan(baseInitiative(stats, 'mage', 70));
  });

  it('PV = Vitalité × 10', () => {
    expect(maxHp(stats, 160)).toBe(1600);
  });

  it('héritage : +25 % de stats par héritage, cumulatif', () => {
    expect(heritageMultiplier(0)).toBe(1);
    expect(heritageMultiplier(3)).toBe(1.75);
  });
});
