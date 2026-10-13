/**
 * Réglages d'équilibrage côté héros et combat, ABSENTS des classeurs.
 * Choisis par Claude à la demande de l'utilisateur (13/10/2026) pour rester cohérents avec
 * le calibrage du bestiaire (joueur de référence au niveau 100 : 1 600 Vitalité, 700 Force/Magie
 * équipement compris) et vérifiés par la simulation de shared/src/combat/simulation.test.ts.
 * Tout le reste (monstres, objets, XP…) vient des classeurs.
 */
import type { ClassId } from './constants.ts';

/** Statistiques de base d'un héros SANS équipement au niveau 100 (suivent la courbe de niveau). */
export const HERO_BASE_STATS_AT_MAX_LEVEL: Record<
  ClassId,
  { vitality: number; strength: number; resistance: number; magic: number; agility: number }
> = {
  // Robuste : beaucoup de Vitalité et de Résistance.
  warrior: { vitality: 1700, strength: 680, resistance: 450, magic: 0, agility: 70 },
  // Fragile mais frappe fort (Magie).
  mage: { vitality: 1350, strength: 0, resistance: 320, magic: 740, agility: 90 },
  // Agile et précis (Force pour les dégâts, Agilité pour l'esquive).
  ranger: { vitality: 1350, strength: 680, resistance: 320, magic: 0, agility: 180 },
};

/**
 * Points de statistiques (demande de l'utilisateur, 13/10/2026) : gagnés à chaque niveau,
 * répartis librement par le joueur sur la page Équipe. L'Initiative n'en fait pas partie
 * (elle décide de l'ordre des camps). Réinitialisation gratuite ; l'héritage les remet à zéro.
 */
export const STAT_POINTS = {
  perLevel: 5,
  /** Gain de la statistique pour 1 point dépensé. */
  valuePerPoint: { vitality: 2, strength: 1, resistance: 1, magic: 1, agility: 1 },
} as const;
export type AllocatableStat = keyof typeof STAT_POINTS.valuePerPoint;
export const ALLOCATABLE_STATS = Object.keys(STAT_POINTS.valuePerPoint) as AllocatableStat[];

/** Statistiques « d'équipement » de base d'un héros nu (comme le monstre étalon du bestiaire). */
export const HERO_BASE_EQUIPMENT_STATS = {
  accuracy: 0.9,
  critChance: 0.05,
  critDamage: 0.5,
} as const;

/**
 * Début de partie plus doux (demande de l'utilisateur, 13/10/2026) : jusqu'à l'étage 10, le temps
 * de débloquer la première zone de chasse et des équipements. Les monstres de niveau 1 à `untilLevel`
 * ont des PV et des stats d'attaque réduits ; le facteur remonte linéairement jusqu'à 1 au niveau suivant.
 * Les récompenses (XP, or, butin) ne changent pas.
 */
export const EARLY_GAME = {
  // Retour progressif à 100 % au niveau 16 : l'étage 10 reste nettement adouci (~84 %).
  untilLevel: 15,
  /** Facteur appliqué aux PV d'un monstre de niveau 1. */
  hpFactorAtLevel1: 0.6,
  /** Facteur appliqué à la Force et à la Magie d'un monstre de niveau 1. */
  attackFactorAtLevel1: 0.6,
} as const;

/** Facteur de début de partie pour une valeur au niveau 1 (1 au-delà de `untilLevel`). */
export function earlyGameFactor(level: number, atLevel1: number): number {
  if (level > EARLY_GAME.untilLevel) return 1;
  return atLevel1 + ((1 - atLevel1) * (level - 1)) / EARLY_GAME.untilLevel;
}

/**
 * Fabrication à l'Atelier (PROPOSITION à valider, absente des classeurs) : un objet Commun +0 coûte
 * en matériau l'équivalent de son prix en boutique (prix Commun du palier ÷ prix unitaire du matériau :
 * 14 bois pour une Épée en bois, plus d'unités quand le matériau est bon marché), × ce facteur.
 */
export const CRAFTING = {
  costShare: 1,
} as const;

export const COMBAT_RULES = {
  /** Écart aléatoire des dégâts : ±10 %. */
  damageVariance: 0.1,
  /** Chance de toucher minimale, quelles que soient les stats. */
  minHitChance: 0.05,
  /** Esquive = plafond × Agilité / (Agilité + K), K = Agilité étalon du niveau × ce multiplicateur. */
  dodgeCap: 0.4,
  dodgeAgilityMultiplier: 3,
  /** Une attaque Mixte : moitié physique (Force), moitié magique (Magie). */
  mixedPhysicalShare: 0.5,
  /** Rôle Soutien : soigne l'allié le plus blessé sous ce seuil de PV, de ce pourcentage de ses PV max. */
  supportHealThreshold: 0.6,
  supportHealShare: 0.15,
  /** Dragon : souffle de zone toutes les N manches (« souffle de zone toutes les 3 tours »). */
  dragonBreathEvery: 3,
  /** Immunité aux contrôles après en avoir subi un (« Immunité 2 tours ensuite »). */
  controlImmunityRounds: 2,
  /**
   * Boss et dragons : durée des contrôles divisée par 2. Un contrôle d'1 tour devient
   * une chance sur 2 de perdre le tour (jamais d'immunité totale).
   */
  bossControlFactor: 0.5,
  /** Les attaques Neutres ignorent 10 % de la Résistance (onglet Éléments des compétences). */
  neutralResistanceIgnore: 0.1,
  /** Esquive maximale, tous bonus compris (Roulade, Pas léger, Ailes célestes…). */
  maxDodge: 0.6,
  /** Durée par défaut des effets des compétences dont le texte ne la précise pas (« 2 tours »). */
  defaultEffectRounds: 2,
} as const;

/**
 * Tour d'alchimie : fusions (décisions de l'utilisateur, 13/10/2026 ; absentes des classeurs).
 * Une fusion ajoute un 2e élément à une compétence d'attaque du deck.
 */
export const ALCHEMY = {
  /** Coût d'une fusion posée sur une compétence (la retirer est gratuit, la reposer coûte à nouveau). */
  fusionCost: { ether: 500, gold: 100_000 },
  /** Niveau 4 : fusions −20 %. */
  discountLevel: 4,
  discount: 0.2,
  /** Compétences fusionnées par héros selon le niveau de la tour (index = niveau). */
  fusionsPerHero: [0, 1, 3, 3, 3, 3],
  /** Niveau 3 : les altérations appliquées par les fusions durent 1 manche de plus. */
  extraDurationLevel: 3,
} as const;
