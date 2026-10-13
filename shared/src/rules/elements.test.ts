import { describe, expect, it } from 'vitest';
import { ELEMENT_IDS } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { elementMultiplier } from './elements.ts';

const data = gameData.elements;

describe('avantages élémentaires', () => {
  it('×1,5 avec avantage, ×0,75 contre une résistance, ×1 sinon', () => {
    expect(elementMultiplier(data, 'water', 'fire')).toBe(1.5);
    expect(elementMultiplier(data, 'fire', 'water')).toBe(0.75);
    expect(elementMultiplier(data, 'fire', 'ice')).toBe(1.5);
    expect(elementMultiplier(data, 'fire', 'earth')).toBe(1);
  });

  it('le Neutre n’a ni avantage ni faiblesse', () => {
    for (const other of ELEMENT_IDS) {
      expect(elementMultiplier(data, 'neutral', other)).toBe(1);
      expect(elementMultiplier(data, other, 'neutral')).toBe(1);
    }
  });

  it('la matrice ne contient que ×0,75, ×1 et ×1,5', () => {
    for (const defender of ELEMENT_IDS) {
      for (const attacker of ELEMENT_IDS) {
        expect([0.75, 1, 1.5]).toContain(elementMultiplier(data, attacker, defender));
      }
    }
  });

  it('chaque biome a son élément, sur 10 étages', () => {
    expect(data.biomes.map((b) => [b.element, b.floorMin, b.floorMax])).toEqual(
      ELEMENT_IDS.map((element, i) => [element, i * 10 + 1, i * 10 + 10]),
    );
  });
});
