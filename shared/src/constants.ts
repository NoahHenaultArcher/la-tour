/**
 * Identifiants fermés utilisés par le code (en anglais).
 * Les libellés affichés viennent des données importées ou du fichier de traduction.
 * L'ordre des listes suit l'ordre des classeurs : il compte (ex. départage des rangs de stats).
 */

export const CLASS_IDS = ['warrior', 'mage', 'ranger'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const SLOT_IDS = [
  'hat',
  'armor',
  'pants',
  'boots',
  'necklace',
  'ring1',
  'ring2',
  'belt',
  'weapon1',
  'weapon2',
] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** Statistiques portées par l'équipement, dans l'ordre des colonnes des classeurs. */
export const STAT_IDS = [
  'vitality',
  'strength',
  'resistance',
  'magic',
  'agility',
  'initiative',
  'accuracy',
  'critChance',
  'critDamage',
  'armor',
  'penetration',
  'elementalResistance',
  'healingBonus',
  'statusResistance',
] as const;
export type StatId = (typeof STAT_IDS)[number];
export type StatBlock = Record<StatId, number>;

/** Statistiques calculées (non portées par les objets). */
export const DERIVED_STAT_IDS = ['maxHp', 'dodge'] as const;
export type DerivedStatId = (typeof DERIVED_STAT_IDS)[number];

export const RARITY_IDS = [
  'common',
  'rare',
  'superRare',
  'epic',
  'mythic',
  'legendary',
  'unique',
] as const;
export type RarityId = (typeof RARITY_IDS)[number];

export const ELEMENT_IDS = [
  'neutral',
  'earth',
  'fire',
  'wind',
  'acid',
  'water',
  'ice',
  'lightning',
  'light',
  'shadow',
] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

export const BIOME_IDS = [
  'forest',
  'mountain',
  'volcano',
  'desert',
  'swamp',
  'ocean',
  'iceberg',
  'highMountain',
  'celestialPalace',
  'demonPalace',
] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export const MONSTER_RANK_IDS = ['weak', 'normal', 'strong', 'boss', 'dragon'] as const;
export type MonsterRankId = (typeof MONSTER_RANK_IDS)[number];

export const MONSTER_ROLE_IDS = [
  'beast',
  'brute',
  'warrior',
  'ranger',
  'mage',
  'support',
  'assassin',
  'elemental',
  'dragon',
] as const;
export type MonsterRoleId = (typeof MONSTER_ROLE_IDS)[number];

export const ATTACK_TYPE_IDS = ['physical', 'magical', 'mixed'] as const;
export type AttackTypeId = (typeof ATTACK_TYPE_IDS)[number];

export const FLOOR_TYPE_IDS = ['normal', 'boss', 'dragon'] as const;
export type FloorTypeId = (typeof FLOOR_TYPE_IDS)[number];

export const ZONE_TYPE_IDS = ['zone', 'lair'] as const;
export type ZoneTypeId = (typeof ZONE_TYPE_IDS)[number];

export const SKILL_FAMILY_IDS = ['attack', 'support', 'passive'] as const;
export type SkillFamilyId = (typeof SKILL_FAMILY_IDS)[number];

export const SKILL_KIND_IDS = ['attack', 'buff', 'debuff', 'shield', 'heal', 'passive'] as const;
export type SkillKindId = (typeof SKILL_KIND_IDS)[number];

export const SKILL_TARGET_IDS = ['single', 'area', 'self'] as const;
export type SkillTargetId = (typeof SKILL_TARGET_IDS)[number];

export const ATTACK_STAT_IDS = ['strength', 'magic'] as const;
export type AttackStatId = (typeof ATTACK_STAT_IDS)[number];

export const UPGRADE_TOWER_BRANCH_IDS = [
  'damage',
  'hp',
  'defense',
  'production',
  'offlineDuration',
  'goldXp',
] as const;
export type UpgradeTowerBranchId = (typeof UPGRADE_TOWER_BRANCH_IDS)[number];

/** Règles du prompt qui ne figurent dans aucun classeur. */
export const GAME_RULES = {
  /** Partage de l'XP selon le nombre de héros dans le combat (solo comme multi). */
  xpShareByHeroCount: { 1: 1, 2: 0.75, 3: 0.5 } as const,
  /** Bonus de statistiques par héritage, cumulatif. */
  heritageStatBonus: 0.25,
  /** Taille maximale d'un salon multijoueur. */
  maxPlayersPerRoom: 3,
  /** Durée d'un tour en multijoueur (secondes). */
  multiplayerTurnSeconds: 60,
} as const;
