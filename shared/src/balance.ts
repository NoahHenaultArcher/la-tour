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
 * Difficulté « exigeante » (phase 9, décision de l'utilisateur du 14/10/2026). Le bestiaire calibre
 * ses monstres sur un joueur de référence équipé ; nos héros le dépassent nettement (stats de base,
 * points par niveau, puis équipement qui grandit plus vite que les monstres). Sans correction, tout
 * était gagné à 100 % après l'étage 50, même sans équipement.
 * PV et attaque des monstres sont multipliés par un facteur qui monte avec leur niveau (même facteur
 * pour tous les biomes : les écarts entre zones voulus par le bestiaire sont conservés).
 * Simulation (scripts/balance-experiment.ts, mode auto, héros seul au niveau de l'étage) :
 * boss ~87 % avec l'équipement attendu, ~60 % avec 5 niveaux de retard, ~25 % sans équipement.
 */
export const MONSTER_SCALING = {
  hpAtLevel1: 1.15,
  hpAtLevel100: 2.4,
  attackAtLevel1: 1.1,
  attackAtLevel100: 2.1,
  /** Début de partie inchangé (étages 1 à 10, demande de l'utilisateur) : aucun renfort jusqu'ici… */
  untilLevel: 10,
  /** …puis le renfort s'installe progressivement et s'applique en entier à partir de ce niveau. */
  fullFromLevel: 20,
} as const;

/** Valeur interpolée linéairement entre le niveau 1 et le niveau 100. */
export function lerpByLevel(level: number, atLevel1: number, atLevel100: number): number {
  const progress = (Math.min(Math.max(level, 1), 100) - 1) / 99;
  return atLevel1 + (atLevel100 - atLevel1) * progress;
}

/** Facteur de difficulté d'un monstre de ce niveau (1 en début de partie, voir MONSTER_SCALING). */
export function monsterDifficulty(level: number, atLevel1: number, atLevel100: number): number {
  const { untilLevel, fullFromLevel } = MONSTER_SCALING;
  if (level <= untilLevel) return 1;
  const full = lerpByLevel(level, atLevel1, atLevel100);
  if (level >= fullFromLevel) return full;
  return 1 + ((full - 1) * (level - untilLevel)) / (fullFromLevel - untilLevel);
}

/**
 * Résistance aux altérations de base d'un héros nu, comme le monstre étalon du bestiaire
 * (5 % au niveau 1 → 30 % au niveau 100) ; l'équipement s'y ajoute.
 */
export const HERO_STATUS_RESISTANCE = { atLevel1: 0.05, atLevel100: 0.3 } as const;

/**
 * Gain d'XP (demande de l'utilisateur, 14/10/2026) : avec la difficulté exigeante, on passait trop
 * de temps à chasser pour monter de niveau. L'XP gagnée en combat (tour et chasse, solo et multi)
 * est multipliée par ce facteur ; la courbe d'XP et l'XP des monstres du bestiaire ne changent pas.
 * 15/10/2026 : doublé (×1,5 → ×3) pour monter la tour plus vite (scripts/progression-sim.ts).
 */
export const XP_GAIN = { multiplier: 3 } as const;

/**
 * Dragons (décision de l'utilisateur, 14/10/2026) : plus seulement des « sacs à PV ».
 * - 2 actions par manche (sur une manche de souffle, la 1re action est le souffle) ;
 * - furie sous la moitié de ses PV : dégâts augmentés et souffle plus fréquent ;
 * - souffle élémentaire : il inflige à coup sûr l'altération de l'élément du dragon (la résistance
 *   aux altérations s'applique toujours, aucune immunité totale) ;
 * - invocations : en passant sous certains seuils de PV, il appelle des monstres de sa zone.
 */
export const DRAGON_RULES = {
  actionsPerRound: 2,
  furyThreshold: 0.5,
  furyDamageBonus: 0.3,
  furyBreathEvery: 2,
  /** Seuils de PV (part des PV max) qui déclenchent chacun une invocation. */
  summonThresholds: [0.66, 0.33],
  /** Monstres appelés à chaque seuil (simulation : 2 par seuil rendait les tanières trop dures). */
  summonCount: 1,
} as const;

/**
 * Taille de l'équipe (décision de l'utilisateur, 14/10/2026) : sans compensation, 3 héros gagnaient
 * tout. Les PV des monstres sont multipliés selon le nombre de héros du combat, en solo comme en
 * multijoueur (index = nombre de héros) : chaque héros en plus « apporte » un monstre de PV.
 * Simulation : un trio sans équipement échoue sur la plupart des boss ; équipé, il en gagne 75 à 100 %.
 */
export const TEAM_SCALING = {
  monsterHpByHeroes: [1, 1, 2, 3],
} as const;

export function monsterHpForTeam(heroCount: number): number {
  const table = TEAM_SCALING.monsterHpByHeroes;
  return table[Math.min(Math.max(1, heroCount), table.length - 1)] ?? 1;
}

/**
 * L'Abysse (décisions de l'utilisateur, 15/10/2026) : étages sans fin, ouverts après l'étage 100.
 * Vagues comme la tour (3 × 3 monstres, boss tous les 5 étages), mais monstres de TOUTES les zones
 * mélangés ; un étage non-boss a une chance d'être une tanière de dragon (élément au hasard).
 * Les monstres ont le niveau 100 + étage (leurs stats suivent la courbe de niveau au-delà de 100)
 * et un renfort qui grandit à chaque étage. Calibrage (scripts/abyss-sim.ts, trio niveau 100, mode auto,
 * 10 essais par étage) : mur médian vers l'étage 15 en Légendaire sans héritage (5-10 en Épique), puis
 * 30, 45 et 55 avec 1, 2 et 3 héritages. La courbe de niveau des monstres (au-delà de 100) fait
 * l'essentiel de la montée : un renfort qui grandit vite rendait les héritages presque inutiles.
 */
export const ABYSS = {
  /** Étage de la tour à terminer pour ouvrir l'Abysse. */
  unlockFloor: 100,
  /** Niveau des monstres : 100 + étage × ce nombre. */
  levelsPerFloor: 1,
  /** PV des monstres : × base × (1 + croissance) ^ (étage − 1). */
  hpBase: 1.85,
  hpGrowth: 0.005,
  /** Attaque des monstres : × base × (1 + croissance) ^ (étage − 1). */
  attackBase: 1.45,
  attackGrowth: 0.005,
  /** Chance qu'un étage non-boss soit une tanière de dragon (tirage fixe pour chaque étage). */
  dragonChance: 0.1,
  /**
   * Dragons de l'Abysse : PV et attaque × ce facteur, en plus du renfort de l'étage. Sans lui, une
   * tanière (2 actions, souffle, invocations, PV × 3 contre un trio) bloquait même avec 3 héritages.
   */
  dragonFactor: 0.5,
  /**
   * Boss de l'Abysse (tirés parmi tous les boss de la tour) : PV et attaque × ce facteur. Sans lui,
   * chaque étage de boss était un mur alors que les étages normaux passaient à coup sûr.
   */
  bossFactor: 0.7,
  /**
   * Fusions ennemies (décision du 15/10/2026, Abysse seulement) : part des monstres qui en possèdent
   * une (leur élément + un élément au hasard, hors dragons), et chance de la déclencher à chaque attaque.
   */
  fusionChance: 0.15,
  fusionTrigger: 0.3,
  /** Butin : chances de Mythique et Légendaire × (1 + croissance × étage), plafonnées. */
  highRarityGrowth: 0.04,
  highRarityMaxBoost: 4,
} as const;

/**
 * Monstres alpha (Abysse uniquement, décision du 15/10/2026) : un monstre sur 20 environ est plus
 * fort que la moyenne et porte un trait ; il rapporte plus et lâche toujours un objet.
 */
export const ALPHA = {
  chance: 0.05,
  hpMultiplier: 2,
  attackMultiplier: 1.5,
  rewardMultiplier: 3,
  /** Enragé : dégâts infligés en plus sous la moitié de ses PV. */
  enragedThreshold: 0.5,
  enragedDamageBonus: 0.5,
  /** Régénération : part des PV max rendue à chaque fin de manche. */
  regeneration: 0.05,
  /** Épines : part des dégâts reçus d'un héros renvoyée à l'attaquant. */
  thorns: 0.15,
  /** Vampirique : part des dégâts infligés rendue en PV. */
  vampiric: 0.3,
  /** Carapace : dégâts reçus réduits. */
  carapace: 0.25,
  /** Rapide : actions par manche. */
  fastActions: 2,
  /** Fusionné : l'alpha possède toujours une fusion, déclenchée plus souvent. */
  fusedTrigger: 0.6,
} as const;

export const ALPHA_TRAIT_IDS = [
  'enraged',
  'regeneration',
  'thorns',
  'vampiric',
  'carapace',
  'fast',
  'fused',
] as const;
export type AlphaTraitId = (typeof ALPHA_TRAIT_IDS)[number];

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
  /**
   * Chaque soin suivant du même soigneur vaut ce facteur du précédent (15 %, 12 %, 9,6 %…) : un
   * soigneur rend au plus 75 % de PV max en tout. Sans cela, un boss qui se soigne (étage 85) pouvait
   * rendre un combat interminable quand le héros frappait moins fort que le soin.
   */
  supportHealDecay: 0.8,
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
