/**
 * Outils du panneau de debug. Chaque action est vérifiée par le serveur :
 * compte admin obligatoire, routes absentes en production.
 */
import { z } from 'zod';
import { CLASS_IDS, ELEMENT_IDS, RARITY_IDS, SLOT_IDS } from '../constants.ts';

const uuid = z.uuid();

export const debugGiveGoldSchema = z.strictObject({
  amount: z.int().min(1).max(1_000_000_000_000),
});

export const debugGiveResourcesSchema = z.strictObject({
  /** Identifiant d'une ressource, ou « all » pour toutes. */
  resourceId: z.string().min(1),
  amount: z.int().min(1).max(10_000_000),
});

export const debugGiveXpSchema = z.strictObject({
  characterId: uuid,
  amount: z.int().min(1).max(1_000_000_000),
});

export const debugSetLevelSchema = z.strictObject({
  characterId: uuid,
  level: z.int().min(1).max(100),
});

export const debugGoToFloorSchema = z.strictObject({
  floor: z.int().min(1).max(100),
});

export const debugUnlockElementSchema = z.strictObject({
  element: z.enum(ELEMENT_IDS),
});

export const debugCreateItemSchema = z.strictObject({
  classId: z.enum(CLASS_IDS),
  slot: z.enum(SLOT_IDS),
  rarity: z.enum(RARITY_IDS),
  /** Palier 1 à 5 (ignoré pour un Unique). */
  tier: z.int().min(1).max(5),
  upgradeLevel: z.int().min(0).max(99),
});

export const debugAdvanceIdleSchema = z.strictObject({
  hours: z.number().positive().max(1000),
});

export type DebugGiveGold = z.infer<typeof debugGiveGoldSchema>;
export type DebugGiveResources = z.infer<typeof debugGiveResourcesSchema>;
export type DebugGiveXp = z.infer<typeof debugGiveXpSchema>;
export type DebugSetLevel = z.infer<typeof debugSetLevelSchema>;
export type DebugGoToFloor = z.infer<typeof debugGoToFloorSchema>;
export type DebugUnlockElement = z.infer<typeof debugUnlockElementSchema>;
export type DebugCreateItem = z.infer<typeof debugCreateItemSchema>;
export type DebugAdvanceIdle = z.infer<typeof debugAdvanceIdleSchema>;
