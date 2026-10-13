import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index.ts';
import { fixtures } from '../test/fixtures.ts';
import { effectiveAlterationChance, huntingLevelRange, monsterStats } from './monsters.ts';

const { monsters, zones } = gameData;
const elementOf = (zoneFloor: number) => zones.zones.find((z) => z.floor === zoneFloor)!.element;

describe('stats des monstres', () => {
  it('reproduisent les 92 monstres de l’onglet Monstres (niveau de la zone)', () => {
    for (const monster of monsters.monsters) {
      expect(
        monsterStats(monsters, monster, monster.zoneFloor, elementOf(monster.zoneFloor)),
        `${monster.id} ${monster.name}`,
      ).toEqual(monster.atZoneLevel);
    }
  });

  it('reproduisent le Calculateur (niveau choisi, min et max de chasse)', () => {
    const { monsterId, levels } = fixtures.monsterCalculator;
    const monster = monsters.monsters.find((m) => m.id === monsterId)!;
    for (const expected of levels) {
      const computed = monsterStats(
        monsters,
        monster,
        expected.level,
        elementOf(monster.zoneFloor),
      );
      const { elementalShare: _e, turnsToKill: _t, rewardMultiplier: _r, ...comparable } = computed;
      expect(comparable, `niveau ${expected.level}`).toEqual(expected);
    }
  });

  it('montent avec le niveau (étage 84 → niveau 84)', () => {
    const boar = monsters.monsters.find((m) => m.name === 'Sanglier')!;
    const low = monsterStats(monsters, boar, 5, 'neutral');
    const high = monsterStats(monsters, boar, 84, 'neutral');
    expect(high.hp).toBeGreaterThan(low.hp);
    expect(high.xp).toBeGreaterThan(low.xp);
  });
});

describe('zones de chasse', () => {
  it('tirent le niveau entre l’étage de la zone et +10', () => {
    expect(huntingLevelRange(monsters, 55)).toEqual({ min: 55, max: 65 });
    for (const zone of zones.zones.filter((z) => z.hasHuntingZone)) {
      expect(huntingLevelRange(monsters, zone.floor)).toEqual({
        min: zone.huntingLevelMin,
        max: zone.huntingLevelMax,
      });
    }
  });
});

describe('altérations', () => {
  it('appliquent la résistance du héros (Calculateur : 25 % × (1 − 15 %) = 21,25 %)', () => {
    expect(effectiveAlterationChance(0.25, 0.15)).toBeCloseTo(0.2125, 12);
  });
});
