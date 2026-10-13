import { describe, expect, it } from 'vitest';
import { CLASS_IDS } from '../constants.ts';
import { gameData } from '../data/index.ts';
import {
  canPlayFloor,
  floorType,
  isReplayable,
  monstersOnFloor,
  unlockedBuildings,
  unlockedElements,
  unlockedHuntingZones,
  wavesOnFloor,
  zoneFloorOf,
} from './tower.ts';

const { floors, monsters, zones, elements, village, skills } = gameData;

describe('étages de la tour (onglet Étages)', () => {
  it('reproduit type, zone, vagues et nombre de monstres des 100 étages', () => {
    for (const floor of floors.floors) {
      const where = `étage ${floor.floor}`;
      expect(floorType(floor.floor), where).toBe(floor.type);
      expect(zoneFloorOf(floor.floor), where).toBe(floor.zoneFloor);
      expect(wavesOnFloor(monsters, floor.floor), where).toBe(floor.waves);
      expect(monstersOnFloor(monsters, floor.floor), where).toBe(floor.monsterCount);
      expect(floor.monsterLevel, where).toBe(floor.floor);
    }
  });

  it('seuls les étages de boss et de dragon sont rejouables', () => {
    expect([5, 9, 10, 15, 19, 20, 99, 100].every(isReplayable)).toBe(true);
    expect([1, 4, 11, 84].some(isReplayable)).toBe(false);
  });

  it('autorise l’étage courant et les boss/dragons déjà battus', () => {
    const progress = { currentFloor: 12, highestFloorCleared: 11 };
    expect(canPlayFloor(progress, 12)).toBe(true);
    expect(canPlayFloor(progress, 10)).toBe(true);
    expect(canPlayFloor(progress, 9)).toBe(true);
    expect(canPlayFloor(progress, 4)).toBe(false);
    expect(canPlayFloor(progress, 13)).toBe(false);
    expect(canPlayFloor(progress, 15)).toBe(false);
    expect(canPlayFloor(progress, 0)).toBe(false);
  });
});

describe('déblocages', () => {
  it('un étage de boss débloque sa zone de chasse ; les tannières n’en ont pas', () => {
    expect(unlockedHuntingZones(zones, 4)).toEqual([]);
    expect(unlockedHuntingZones(zones, 5).map((z) => z.name)).toEqual(['Forêt de chasse']);
    expect(unlockedHuntingZones(zones, 9).map((z) => z.name)).toEqual(['Forêt de chasse']);
    expect(unlockedHuntingZones(zones, 100)).toHaveLength(20);
    for (const floor of floors.floors.filter((f) => f.unlocksHuntingZone !== null)) {
      expect(unlockedHuntingZones(zones, floor.floor).at(-1)!.name).toBe(floor.unlocksHuntingZone);
    }
  });

  it('les éléments se débloquent en terminant le dernier étage du biome', () => {
    expect(unlockedElements(elements, 0)).toEqual(['neutral']);
    expect(unlockedElements(elements, 19)).toEqual(['neutral']);
    expect(unlockedElements(elements, 20)).toEqual(['neutral', 'earth']);
    const floorsByElement = Object.fromEntries(elements.elements.map((e) => [e.id, e.unlockFloor]));
    expect(floorsByElement).toEqual({
      neutral: 0,
      earth: 20,
      fire: 30,
      wind: 40,
      acid: 50,
      water: 60,
      ice: 70,
      lightning: 80,
      light: 90,
      shadow: 100,
    });
  });

  it('les bâtiments se débloquent par étage (Mine et Atelier à 15, Alchimie à 85, Tour d’amélioration à 100)', () => {
    expect(unlockedBuildings(village, 14)).not.toContain('mine');
    expect(unlockedBuildings(village, 15)).toEqual(
      expect.arrayContaining(['mine', 'atelier_fabrication']),
    );
    expect(unlockedBuildings(village, 84)).not.toContain('tour_alchimie');
    expect(unlockedBuildings(village, 85)).toContain('tour_alchimie');
    expect(unlockedBuildings(village, 100)).toContain('tour_amelioration');
    expect(unlockedBuildings(village, 0)).toEqual([
      'taverne',
      'entrepot',
      'scierie',
      'champs',
      'terrain_de_chasse',
      'tour',
    ]);
  });

  it('reproduit l’onglet Déblocages (compétences disponibles à chaque étape, niveau = étage)', () => {
    for (const step of skills.unlockProgression) {
      const elementsUnlocked = unlockedElements(elements, step.floor);
      for (const classId of CLASS_IDS) {
        const bases = skills.bases.filter(
          (b) => b.classId === classId && b.requiredLevel <= step.floor,
        );
        const actives =
          bases.filter((b) => b.family !== 'passive').length * elementsUnlocked.length;
        const passives = bases.filter((b) => b.family === 'passive').length;
        expect({ actives, passives }, `étage ${step.floor}, ${classId}`).toEqual(
          step.counts[classId],
        );
      }
      expect(elementsUnlocked.length, `affinités étage ${step.floor}`).toBe(step.affinities);
      const fusions = skills.fusions.filter((f) => f.availableAfterFloor <= step.floor).length;
      expect(fusions, `fusions étage ${step.floor}`).toBe(step.fusions);
    }
  });
});
