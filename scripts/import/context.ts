import path from 'node:path';
import { ImageIndex } from './manifest.ts';
import { Workbook } from './workbook.ts';

export const WORKBOOK_FILES = {
  stats: 'Resume_statistiques_RPG.xlsx',
  skills: 'Competences_RPG_Tour.xlsx',
  equipment: 'Equipements_RPG_Tour.xlsx',
  bestiary: 'Bestiaire_Tour_RPG.xlsx',
  elements: 'Elements_Fusions_RPG_Tour.xlsx',
  village: 'Village_RPG_Tour.xlsx',
} as const;

export interface ImportContext {
  books: Record<keyof typeof WORKBOOK_FILES, Workbook>;
  images: ImageIndex;
}

export function createContext(docsDir: string, assetsDir: string): ImportContext {
  const books = Object.fromEntries(
    Object.entries(WORKBOOK_FILES).map(([key, file]) => [
      key,
      new Workbook(path.join(docsDir, file)),
    ]),
  ) as ImportContext['books'];
  return { books, images: new ImageIndex(assetsDir) };
}

/** Courbe de niveau commune : a + (1 − a) × ((N − min) / (max − min)) ^ p. */
export function readLevelCurve(
  sheet: ReturnType<Workbook['sheet']>,
  labels: { min: string; max: string; base: string; exponent: string },
) {
  return {
    minLevel: sheet.param(labels.min),
    maxLevel: sheet.param(labels.max),
    base: sheet.param(labels.base),
    exponent: sheet.param(labels.exponent),
  };
}
