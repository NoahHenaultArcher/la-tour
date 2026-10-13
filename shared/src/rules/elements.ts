import type { ElementId } from '../constants.ts';
import type { ElementsData } from '../data/schemas.ts';

/**
 * Multiplicateur élémentaire d'une attaque : ×1,5 (avantage), ×0,75 (résistance) ou ×1.
 * Pour une fusion, seul l'élément principal (le 1er) compte (règle du fichier Éléments/Fusions).
 */
export function elementMultiplier(
  data: ElementsData,
  attacker: ElementId,
  defender: ElementId,
): number {
  return data.matrix[defender][attacker];
}
