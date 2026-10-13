import { z } from 'zod';
import { CLASS_IDS, SLOT_IDS } from '../constants.ts';

export const equipItemBodySchema = z.strictObject({
  itemId: z.uuid(),
  characterId: z.uuid(),
});
export type EquipItemBody = z.infer<typeof equipItemBodySchema>;

export const itemIdBodySchema = z.strictObject({ itemId: z.uuid() });
export type ItemIdBody = z.infer<typeof itemIdBodySchema>;

/** Fabrication à l'Atelier : un objet Commun +0 d'une classe possédée, d'un palier ouvert. */
export const craftItemBodySchema = z.strictObject({
  classId: z.enum(CLASS_IDS),
  slot: z.enum(SLOT_IDS),
  tier: z.int().min(1).max(5),
});
export type CraftItemBody = z.infer<typeof craftItemBodySchema>;
