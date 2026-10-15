import { z } from 'zod';
import type { StatAllocation } from '../rules/statPoints.ts';
import {
  CLASS_IDS,
  type ClassId,
  type ElementId,
  type SlotId,
  type UpgradeTowerBranchId,
} from '../constants.ts';

export const chooseClassBodySchema = z.strictObject({ classId: z.enum(CLASS_IDS) });
export type ChooseClassBody = z.infer<typeof chooseClassBodySchema>;

export interface CharacterSkillDto {
  /** 0 à 2 : actives ; 3 et 4 : passives. */
  position: number;
  skillId: string;
  fusionElement: ElementId | null;
}

export interface CharacterDto {
  id: string;
  classId: ClassId;
  level: number;
  /** Meilleur niveau atteint (déblocages des compétences, conservés après un héritage). */
  bestLevel: number;
  /** XP accumulée dans le niveau en cours. */
  xp: number;
  /** XP pour passer au niveau suivant (null au niveau maximum). */
  xpToNextLevel: number | null;
  skills: CharacterSkillDto[];
  /** Points de statistiques : répartis, restants et gagnés au total. */
  statPoints: { allocated: StatAllocation; available: number; total: number };
}

export interface ItemDto {
  id: string;
  catalogId: string;
  upgradeLevel: number;
  equippedBy: string | null;
  slot: SlotId | null;
}

/** État complet de la sauvegarde, tel que calculé par le serveur. */
export interface SaveDto {
  gold: number;
  currentFloor: number;
  highestFloorCleared: number;
  bestFloorEver: number;
  heritageCount: number;
  /** Abysse : prochain étage à jouer, étages terminés depuis l'héritage, record de toujours. */
  abyssFloor: number;
  abyssCleared: number;
  bestAbyssFloor: number;
  unlockedElements: ElementId[];
  lastIdleCollectAt: string;
  characters: CharacterDto[];
  items: ItemDto[];
  /** Reliques et œufs possédés, et leur emplacement (0 à 5) s'ils sont équipés. */
  relics: { relicId: string; slot: number | null }[];
  /** Stock de chaque ressource possédée. */
  resources: Record<string, number>;
  /** Niveau de chaque bâtiment construit. */
  buildings: Record<string, number>;
  upgradeTower: Partial<Record<UpgradeTowerBranchId, number>>;
  updatedAt: string;
  /** Heure du serveur au moment de la réponse : le client s'y recale (son horloge n'est jamais crue). */
  serverTime: string;
}
