import { z } from 'zod';
import { ALLOCATABLE_STATS } from '../balance.ts';
import { ELEMENT_IDS } from '../constants.ts';

const points = z.int().min(0).max(1000);

/** Points ajoutés à chaque statistique (le serveur vérifie qu'il en reste assez). */
export const allocateStatPointsBodySchema = z.strictObject({
  characterId: z.uuid(),
  add: z.strictObject(
    Object.fromEntries(ALLOCATABLE_STATS.map((s) => [s, points.optional()])) as Record<
      (typeof ALLOCATABLE_STATS)[number],
      z.ZodOptional<typeof points>
    >,
  ),
});
export type AllocateStatPointsBody = z.infer<typeof allocateStatPointsBodySchema>;

export const characterIdBodySchema = z.strictObject({ characterId: z.uuid() });
export type CharacterIdBody = z.infer<typeof characterIdBodySchema>;

/** Nouveau deck complet d'un héros (le serveur vérifie déblocages, ultime et fusions). */
export const setDeckBodySchema = z.strictObject({
  characterId: z.uuid(),
  deck: z
    .array(
      z.strictObject({
        position: z.int().min(0).max(4),
        skillId: z.string().min(1).max(32),
        fusionElement: z.enum(ELEMENT_IDS).nullable(),
      }),
    )
    .max(5),
});
export type SetDeckBody = z.infer<typeof setDeckBodySchema>;
