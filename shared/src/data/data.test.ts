import { describe, expect, it } from 'vitest';
import { CLASS_IDS, SLOT_IDS } from '../constants.ts';
import { gameData } from './index.ts';

describe('chargement des données', () => {
  it('valide et charge tous les domaines', () => {
    expect(gameData.equipment.catalog).toHaveLength(930);
    expect(gameData.equipment.uniques).toHaveLength(30);
    expect(gameData.skills.bases).toHaveLength(79);
    expect(gameData.skills.catalog).toHaveLength(484);
    expect(gameData.skills.fusions).toHaveLength(55);
    expect(gameData.monsters.monsters).toHaveLength(92);
    expect(gameData.zones.zones).toHaveLength(30);
    expect(gameData.floors.floors).toHaveLength(100);
    expect(gameData.elements.elements).toHaveLength(10);
  });

  it('chaque classe a un objet par slot, palier et rareté', () => {
    for (const classId of CLASS_IDS) {
      for (const slot of SLOT_IDS) {
        expect(
          gameData.equipment.catalog.filter((c) => c.classId === classId && c.slot === slot),
        ).toHaveLength(31);
      }
    }
  });

  it('prix des 2e et 3e personnages : 50 400 et 232 400 or', () => {
    expect(gameData.shop.characters.map((c) => [c.purchaseNumber, c.price])).toEqual([
      [2, 50_400],
      [3, 232_400],
    ]);
  });

  it('toile, verre et cuivre ne s’obtiennent qu’à la taverne', () => {
    const tavernOnly = gameData.resources.resources
      .filter((r) => r.source === 'taverne')
      .map((r) => r.id);
    expect(tavernOnly.sort()).toEqual(['cuivre', 'toile', 'verre']);
  });
});
