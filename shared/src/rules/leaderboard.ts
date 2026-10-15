/**
 * Classement des joueurs (demande de l'utilisateur, 15/10/2026) : score composé de la progression
 * de la tour, des héritages, des niveaux des héros, de la puissance de l'équipement porté et des
 * niveaux des bâtiments, puis le record de l'Abysse (ajouté le 15/10/2026).
 * Un héritage vaut une tour complète + 3 héros au niveau 100 : le score ne baisse jamais quand on
 * hérite (on perd les étages et les niveaux, l'équipement et le village sont gardés). Le record de
 * l'Abysse est conservé lui aussi, même si l'héritage remet l'Abysse à zéro.
 * Ordres de grandeur au maximum : étages 5 000, niveaux 3 000, équipement ~5 200, village ~2 900.
 */
import type { EquipmentData } from '../data/schemas.ts';
import type { CatalogItem } from './equipment.ts';
import { itemPower, itemStats } from './equipment.ts';

export const LEADERBOARD_SCORE = {
  perFloorCleared: 50,
  perHeritage: 8000,
  perHeroLevel: 10,
  perEquipmentPower: 10,
  perBuildingLevel: 20,
  /** Par étage du record de l'Abysse (meilleur étage jamais terminé). */
  perAbyssFloor: 150,
  /** Nombre de joueurs affichés dans le classement. */
  size: 10,
} as const;

export interface LeaderboardInput {
  /** Étages terminés dans la partie en cours (remis à zéro par l'héritage). */
  floorsCleared: number;
  heritageCount: number;
  heroLevels: readonly number[];
  /** Objets portés par les héros. */
  equipped: readonly { item: CatalogItem; upgradeLevel: number; wearerLevel?: number }[];
  buildingLevels: readonly number[];
  /** Record de l'Abysse (0 si jamais entré). */
  bestAbyssFloor?: number;
}

export interface LeaderboardScore {
  total: number;
  floors: number;
  heritage: number;
  heroes: number;
  equipment: number;
  buildings: number;
  abyss: number;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export function leaderboardScore(data: EquipmentData, input: LeaderboardInput): LeaderboardScore {
  const w = LEADERBOARD_SCORE;
  const power = sum(
    input.equipped.map(({ item, upgradeLevel, wearerLevel }) =>
      itemPower(data, itemStats(data, item, upgradeLevel, wearerLevel)),
    ),
  );
  const parts = {
    floors: input.floorsCleared * w.perFloorCleared,
    heritage: input.heritageCount * w.perHeritage,
    heroes: sum(input.heroLevels) * w.perHeroLevel,
    equipment: Math.round(power * w.perEquipmentPower),
    buildings: sum(input.buildingLevels) * w.perBuildingLevel,
    abyss: (input.bestAbyssFloor ?? 0) * w.perAbyssFloor,
  };
  return { ...parts, total: sum(Object.values(parts)) };
}
