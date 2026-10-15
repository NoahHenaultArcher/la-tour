import { z } from 'zod';
import { RELIC_IDS, RELIC_RULES } from '../rules/relics.ts';

/** Équiper une relique possédée dans un emplacement (celle qui l'occupait est retirée). */
export const equipRelicBodySchema = z.strictObject({
  relicId: z.enum(RELIC_IDS as [string, ...string[]]),
  slot: z
    .int()
    .min(0)
    .max(RELIC_RULES.slots - 1),
});
export type EquipRelicBody = z.infer<typeof equipRelicBodySchema>;

export const unequipRelicBodySchema = z.strictObject({
  relicId: z.enum(RELIC_IDS as [string, ...string[]]),
});
export type UnequipRelicBody = z.infer<typeof unequipRelicBodySchema>;
