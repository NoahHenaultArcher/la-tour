import { describe, expect, it } from 'vitest';
import { ELEMENTS, fromLabel, slugify, splitList } from './labels.ts';
import { ImportError, normalizeLabel } from './workbook.ts';

describe('slugify (noms de fichiers des images)', () => {
  it('suit la convention des assets', () => {
    expect(slugify('Frappe rapide de pierre')).toBe('frappe_rapide_de_pierre');
    expect(slugify("Pluie d'eau")).toBe('pluie_d_eau');
    expect(slugify('Cuir clouté')).toBe('cuir_cloute');
    expect(slugify('Œil de faucon')).toBe('oeil_de_faucon');
    expect(slugify('Électricité')).toBe('electricite');
    expect(slugify('Contre-attaque')).toBe('contre_attaque');
  });
});

describe('libellés des classeurs', () => {
  it('convertit un libellé en identifiant, sans tenir compte de l’apostrophe', () => {
    expect(fromLabel(ELEMENTS, 'Électricité', 'test')).toBe('lightning');
    expect(normalizeLabel('Effet de l’élément')).toBe(normalizeLabel("Effet de l'élément"));
  });

  it('échoue clairement sur un libellé inconnu', () => {
    expect(() => fromLabel(ELEMENTS, 'Plasma', 'Classeur › Onglet ligne 4')).toThrow(ImportError);
    expect(() => fromLabel(ELEMENTS, 'Plasma', 'Classeur › Onglet ligne 4')).toThrow(
      /Plasma.*Valeurs attendues/,
    );
  });

  it('découpe les listes « A, B » et ignore « — »', () => {
    expect(splitList('Acide, Vent')).toEqual(['Acide', 'Vent']);
    expect(splitList('—')).toEqual([]);
    expect(splitList(null)).toEqual([]);
  });
});
