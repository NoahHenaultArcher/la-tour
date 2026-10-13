import { z } from 'zod';
import type { SaveDto } from './save.ts';

export const upgradeBuildingBodySchema = z.strictObject({
  buildingId: z.string().min(1).max(64),
});
export type UpgradeBuildingBody = z.infer<typeof upgradeBuildingBodySchema>;

/** Rapport d'une collecte idle (fenêtre « Pendant votre absence »). */
export interface IdleReport {
  /** Temps réel écoulé depuis la dernière collecte, en heures. */
  elapsedHours: number;
  /** Heures réellement comptées (plafonnées à la durée hors ligne maximale). */
  countedHours: number;
  /** Quantité produite par ressource. */
  produced: Record<string, number>;
  /** Ressources dont le stock a atteint la capacité de l'entrepôt. */
  full: string[];
}

export interface CollectResponse {
  save: SaveDto;
  report: IdleReport;
}
