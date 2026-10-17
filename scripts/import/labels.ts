/**
 * Correspondance entre les libellés français des classeurs et les identifiants du code.
 * Un libellé inconnu fait échouer l'import avec un message clair.
 */
import type {
  AttackStatId,
  AttackTypeId,
  BiomeId,
  ClassId,
  DerivedStatId,
  ElementId,
  FloorTypeId,
  MonsterRankId,
  MonsterRoleId,
  RarityId,
  SkillFamilyId,
  SkillKindId,
  SkillTargetId,
  SlotId,
  StatId,
  UpgradeTowerBranchId,
  ZoneTypeId,
} from '@la-tour/shared';
import { ImportError, normalizeLabel } from './workbook.ts';

export type LabelMap<T extends string> = Readonly<Record<string, T>>;

export function fromLabel<T extends string>(map: LabelMap<T>, label: string, context: string): T {
  const wanted = normalizeLabel(label);
  for (const [key, id] of Object.entries(map)) {
    if (normalizeLabel(key) === wanted) return id;
  }
  throw new ImportError(
    `${context} : valeur inconnue « ${label} ». Valeurs attendues : ${Object.keys(map).join(', ')}.`,
  );
}

/** Libellé français d'un identifiant (sens inverse). */
export function labelOf<T extends string>(map: LabelMap<T>, id: T): string {
  const entry = Object.entries(map).find(([, value]) => value === id);
  if (!entry) throw new ImportError(`Aucun libellé pour l'identifiant « ${id} ».`);
  return entry[0];
}

/** Identifiant de fichier à partir d'un nom français (même règle que les images). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Découpe une liste « A, B, C » ; « — » donne une liste vide. */
export function splitList(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '—');
}

export const CLASSES: LabelMap<ClassId> = { Guerrier: 'warrior', Mage: 'mage', Tireur: 'ranger' };

/** Préfixe des identifiants du catalogue (GUE-CHA-P1-COM…). */
export const CLASS_CODES: Readonly<Record<ClassId, string>> = {
  warrior: 'GUE',
  mage: 'MAG',
  ranger: 'TIR',
};

export const SLOTS: LabelMap<SlotId> = {
  Chapeau: 'hat',
  Armure: 'armor',
  Pantalon: 'pants',
  Botte: 'boots',
  Collier: 'necklace',
  'Anneau 1': 'ring1',
  'Anneau 2': 'ring2',
  Ceinture: 'belt',
  'Arme 1': 'weapon1',
  'Arme 2': 'weapon2',
};

export const STATS: LabelMap<StatId> = {
  Vitalité: 'vitality',
  Force: 'strength',
  Résistance: 'resistance',
  Magie: 'magic',
  Agilité: 'agility',
  Initiative: 'initiative',
  Précision: 'accuracy',
  'Chance de critique': 'critChance',
  'Dégâts critiques': 'critDamage',
  Armure: 'armor',
  Pénétration: 'penetration',
  'Résistance élémentaire': 'elementalResistance',
  'Bonus de soins': 'healingBonus',
  'Résistance aux altérations': 'statusResistance',
};

/** Libellés du fichier « Résumé statistiques » (quelques variantes de nom). */
export const SUMMARY_STATS: LabelMap<StatId | DerivedStatId> = {
  ...STATS,
  'Résistances élémentaires': 'elementalResistance',
  'Points de vie maximum': 'maxHp',
  Esquive: 'dodge',
};

export const RARITIES: LabelMap<RarityId> = {
  Commun: 'common',
  Rare: 'rare',
  'Super rare': 'superRare',
  Épique: 'epic',
  Mythique: 'mythic',
  Légendaire: 'legendary',
  Unique: 'unique',
};

/** Identifiants des cadres de rareté dans manifest.json. */
export const RARITY_FRAME_IDS: Readonly<Record<RarityId, string>> = {
  common: 'commun',
  rare: 'rare',
  superRare: 'super_rare',
  epic: 'epique',
  mythic: 'mythique',
  legendary: 'legendaire',
  unique: 'unique',
};

export const ELEMENTS: LabelMap<ElementId> = {
  Neutre: 'neutral',
  Terre: 'earth',
  Feu: 'fire',
  Vent: 'wind',
  Acide: 'acid',
  Eau: 'water',
  Glace: 'ice',
  Électricité: 'lightning',
  Lumière: 'light',
  Ombre: 'shadow',
};

export const BIOMES: LabelMap<BiomeId> = {
  Forêt: 'forest',
  Montagne: 'mountain',
  Volcan: 'volcano',
  Désert: 'desert',
  Marais: 'swamp',
  'Océan / Île': 'ocean',
  Iceberg: 'iceberg',
  'Haute montagne': 'highMountain',
  'Palais céleste': 'celestialPalace',
  'Palais démoniaque': 'demonPalace',
};

export const RANKS: LabelMap<MonsterRankId> = {
  Faible: 'weak',
  Normal: 'normal',
  Fort: 'strong',
  Boss: 'boss',
  Dragon: 'dragon',
};

export const ROLES: LabelMap<MonsterRoleId> = {
  Bête: 'beast',
  Brute: 'brute',
  Guerrier: 'warrior',
  Tireur: 'ranger',
  Mage: 'mage',
  Soutien: 'support',
  Assassin: 'assassin',
  Élémentaire: 'elemental',
  Dragon: 'dragon',
};

export const ATTACK_TYPES: LabelMap<AttackTypeId> = {
  Physique: 'physical',
  Magique: 'magical',
  Mixte: 'mixed',
};

export const FLOOR_TYPES: LabelMap<FloorTypeId> = {
  Normal: 'normal',
  Boss: 'boss',
  Dragon: 'dragon',
};

export const ZONE_TYPES: LabelMap<ZoneTypeId> = { Zone: 'zone', Tannière: 'lair' };

export const SKILL_FAMILIES: LabelMap<SkillFamilyId> = {
  'Attaque (arme 1)': 'attack',
  'Soutien (arme 2)': 'support',
  Passif: 'passive',
};

export const SKILL_KINDS: LabelMap<SkillKindId> = {
  Attaque: 'attack',
  Buff: 'buff',
  Debuff: 'debuff',
  Bouclier: 'shield',
  Soin: 'heal',
  Passif: 'passive',
};

export const SKILL_TARGETS: LabelMap<SkillTargetId> = {
  Mono: 'single',
  Zone: 'area',
  Soi: 'self',
  Équipe: 'team',
};

export const ATTACK_STATS: LabelMap<AttackStatId> = { Force: 'strength', Magie: 'magic' };

export const UPGRADE_TOWER_BRANCHES: LabelMap<UpgradeTowerBranchId> = {
  Dégâts: 'damage',
  'Points de vie': 'hp',
  Défense: 'defense',
  'Production du village': 'production',
  'Durée hors ligne': 'offlineDuration',
  'Or et XP': 'goldXp',
};

/** Provenance d'une ressource (onglet Matériaux) → identifiant du bâtiment. */
export const RESOURCE_SOURCES: LabelMap<string> = {
  Scierie: 'scierie',
  Champs: 'champs',
  'Terrain de chasse': 'terrain_de_chasse',
  Mine: 'mine',
  "Tour d'alchimie": 'tour_alchimie',
  'Taverne (marchand)': 'taverne',
};
