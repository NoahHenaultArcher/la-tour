/**
 * Format commun des erreurs de l'API. Le serveur renvoie un code ; le client affiche
 * le texte correspondant de fr.json (aucun texte d'interface côté serveur).
 */
export const API_ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TOO_MANY_REQUESTS',
  'USERNAME_TAKEN',
  'INVALID_CREDENTIALS',
  'CLASS_ALREADY_CHOSEN',
  'NO_CHARACTER',
  'BUILDING_LOCKED',
  'NOT_UPGRADABLE',
  'MAX_LEVEL',
  'FLOOR_REQUIRED',
  'NOT_ENOUGH_RESOURCES',
  'FLOOR_LOCKED',
  'COMBAT_IN_PROGRESS',
  'NO_COMBAT',
  'NOT_YOUR_TURN',
  'INVALID_HERO',
  'INVALID_SKILL',
  'SKILL_ON_COOLDOWN',
  'INVALID_TARGET',
  'COMBAT_OVER',
  'WRONG_CLASS',
  'CLASS_NOT_OWNED',
  'TIER_LOCKED',
  'ITEM_MAX_LEVEL',
  'NOT_ENOUGH_POINTS',
  'NOT_A_HUNT',
  'ZONE_LOCKED',
  'ABYSS_LOCKED',
  'NOT_ENOUGH_GOLD',
  'OFFER_UNAVAILABLE',
  'CLASS_ALREADY_OWNED',
  'ITEM_EQUIPPED',
  'INVALID_DECK',
  'SKILL_LOCKED',
  'DUPLICATE_SKILL',
  'TOO_MANY_ULTIMATES',
  'FUSION_LOCKED',
  'TOO_MANY_FUSIONS',
  'HERITAGE_LOCKED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ALREADY_IN_ROOM',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'PLAYERS_NOT_READY',
  'NO_CONTENT',
  'IN_MULTI_COMBAT',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Détail technique (champs invalides, délai d'attente…), jamais affiché tel quel. */
    details?: unknown;
  };
}
