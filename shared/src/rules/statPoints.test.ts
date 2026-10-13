import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { heroStats } from './heroes.ts';
import {
  addStatPoints,
  allocationBonus,
  availableStatPoints,
  emptyAllocation,
  toAllocation,
  totalStatPoints,
} from './statPoints.ts';

describe('points de statistiques', () => {
  it('5 points par niveau gagné', () => {
    expect(totalStatPoints(1)).toBe(0);
    expect(totalStatPoints(2)).toBe(5);
    expect(totalStatPoints(100)).toBe(495);
  });

  it('se répartissent sans dépasser les points gagnés', () => {
    const allocation = addStatPoints(3, emptyAllocation(), { strength: 6, vitality: 4 })!;
    expect(allocation).toMatchObject({ strength: 6, vitality: 4 });
    expect(availableStatPoints(3, allocation)).toBe(0);
    expect(addStatPoints(3, allocation, { magic: 1 })).toBeNull();
    expect(addStatPoints(3, emptyAllocation(), { strength: -1 })).toBeNull();
    expect(addStatPoints(3, emptyAllocation(), { strength: 1.5 })).toBeNull();
  });

  it('1 point = +2 Vitalité ou +1 dans les autres stats', () => {
    expect(allocationBonus({ ...emptyAllocation(), vitality: 3, agility: 2 })).toMatchObject({
      vitality: 6,
      agility: 2,
      strength: 0,
    });
  });

  it('s’ajoutent aux stats du héros, avant le bonus d’héritage', () => {
    const base = { classId: 'warrior' as const, level: 10, heritageCount: 0, equipment: [] };
    const allocation = { ...emptyAllocation(), strength: 45 };
    expect(heroStats(gameData.stats, { ...base, allocation }).strength).toBe(
      heroStats(gameData.stats, base).strength + 45,
    );
  });

  it('ignore une répartition invalide lue en base', () => {
    expect(toAllocation({ strength: 4, initiative: 9, magic: -2, foo: 1 })).toEqual({
      ...emptyAllocation(),
      strength: 4,
    });
    expect(toAllocation(null)).toEqual(emptyAllocation());
  });
});
