/**
 * Équipements : stats d'un objet à un niveau d'amélioration, coût et ressource d'amélioration.
 * Formules de Equipements_RPG_Tour.xlsx (Paramètres, Catalogue, Amélioration).
 */
import {
  STAT_IDS,
  type ClassId,
  type RarityId,
  type SlotId,
  type StatBlock,
} from '../constants.ts';
import { UNIQUE_ITEMS } from '../balance.ts';
import type { EquipmentData } from '../data/schemas.ts';
import { excelRound, levelFactor } from './math.ts';

export type CatalogItem = EquipmentData['catalog'][number];
export type ItemProfile = EquipmentData['profiles'][number];
export type RarityInfo = EquipmentData['rarities'][number];

export interface UpgradeCost {
  resourceId: string;
  quantity: number;
}

export function findProfile(data: EquipmentData, classId: ClassId, slot: SlotId): ItemProfile {
  const profile = data.profiles.find((p) => p.classId === classId && p.slot === slot);
  if (!profile) throw new Error(`Profil d'équipement introuvable : ${classId} / ${slot}`);
  return profile;
}

export function findRarity(data: EquipmentData, rarity: RarityId): RarityInfo {
  const info = data.rarities.find((r) => r.id === rarity);
  if (!info) throw new Error(`Rareté inconnue : ${rarity}`);
  return info;
}

/** Amélioration maximale : celle du palier, ou celle commune à tous les Uniques (balance.ts). */
export function maxUpgrade(item: CatalogItem): number {
  return item.rarity === 'unique' ? UNIQUE_ITEMS.maxUpgrade : item.maxUpgrade;
}

/** L'amélioration ne peut dépasser le maximum de l'objet (palier ou Unique). */
export function clampUpgrade(item: CatalogItem, upgrade: number): number {
  return Math.min(Math.max(0, Math.round(upgrade)), maxUpgrade(item));
}

/** Niveau effectif = niveau de base du matériau (ou de l'Unique) + amélioration. */
export function effectiveLevel(item: CatalogItem, upgrade: number): number {
  return item.baseLevel + clampUpgrade(item, upgrade);
}

/**
 * Stats d'un objet : poids du slot × K × multiplicateur de rareté × facteur(niveau effectif), arrondi.
 * Une rareté ne débloque que les N stats les mieux classées du profil.
 */
export function statsAtLevel(
  data: EquipmentData,
  profile: ItemProfile,
  rarity: RarityInfo,
  level: number,
): StatBlock {
  const factor = levelFactor(level, data.params.levelCurve);
  const stats = {} as StatBlock;
  for (const id of STAT_IDS) {
    const weight = profile.weights[id];
    const rank = profile.ranks[id];
    const info = data.stats.find((s) => s.id === id)!;
    stats[id] =
      weight > 0 && rank <= rarity.statLines
        ? excelRound(weight * info.referenceValue * rarity.statMultiplier * factor, info.decimals)
        : 0;
  }
  return stats;
}

/**
 * Niveau utilisé pour les stats : le niveau effectif de l'objet. Un Unique vaut le niveau de son
 * porteur (au moins celui de son biome, au plus 100) ; son amélioration s'y ajoute en bonus
 * (balance.ts, UNIQUE_ITEMS).
 */
export function statLevel(
  data: EquipmentData,
  item: CatalogItem,
  upgrade: number,
  wearerLevel?: number,
): number {
  if (item.rarity !== 'unique') return effectiveLevel(item, upgrade);
  return Math.max(item.baseLevel, Math.min(wearerLevel ?? 0, data.params.levelCurve.maxLevel));
}

/**
 * Bonus d'amélioration d'un Unique : +1 % par niveau sur chaque stat. La stat principale de l'objet
 * (rang 1 de son profil) gagne au moins un cran par niveau (1 point, ou 0,1 %), pour que chaque
 * amélioration se voie ; l'imposer sur toutes les lignes doublait presque l'objet à +30.
 */
function uniqueUpgradeBonus(
  data: EquipmentData,
  profile: ItemProfile,
  base: StatBlock,
  upgrade: number,
): StatBlock {
  if (upgrade === 0) return base;
  const stats = { ...base };
  for (const info of data.stats) {
    const value = base[info.id];
    if (value <= 0) continue;
    const scaled = value * (1 + UNIQUE_ITEMS.bonusPerUpgrade * upgrade);
    const minimum = profile.ranks[info.id] === 1 ? value + upgrade * 10 ** -info.decimals : 0;
    stats[info.id] = excelRound(Math.max(scaled, minimum), info.decimals);
  }
  return stats;
}

/**
 * Stats d'un objet à un niveau d'amélioration. `wearerLevel` : niveau du héros qui le porte
 * (ou le porterait) ; seuls les Uniques en tiennent compte. Les Uniques ont leur propre
 * multiplicateur et leur bonus d'amélioration (balance.ts) ; les autres raretés suivent le classeur.
 */
export function itemStats(
  data: EquipmentData,
  item: CatalogItem,
  upgrade: number,
  wearerLevel?: number,
): StatBlock {
  const rarity = findRarity(data, item.rarity);
  const profile = findProfile(data, item.classId, item.slot);
  const level = statLevel(data, item, upgrade, wearerLevel);
  if (item.rarity !== 'unique') return statsAtLevel(data, profile, rarity, level);
  const base = statsAtLevel(
    data,
    profile,
    { ...rarity, statMultiplier: UNIQUE_ITEMS.statMultiplier },
    level,
  );
  return uniqueUpgradeBonus(data, profile, base, clampUpgrade(item, upgrade));
}

/** Puissance indicative d'un objet : somme des stats rapportées à leur valeur de référence K. */
export function itemPower(data: EquipmentData, stats: StatBlock): number {
  let total = 0;
  for (const info of data.stats) total += stats[info.id] / info.referenceValue;
  return excelRound(total, 1);
}

/** Quantité de ressource pour passer au niveau d'amélioration `targetUpgrade` (1 ou plus). */
export function upgradeQuantity(
  data: EquipmentData,
  rarity: RarityId,
  targetUpgrade: number,
): number {
  const { baseQuantity, exponent } = data.params.upgradeCost;
  return excelRound(
    baseQuantity * targetUpgrade ** exponent * findRarity(data, rarity).upgradeCostMultiplier,
  );
}

/** Ressource totale pour aller de +from à +to. */
export function totalUpgradeQuantity(
  data: EquipmentData,
  rarity: RarityId,
  from: number,
  to: number,
): number {
  let total = 0;
  for (let level = from + 1; level <= to; level++) total += upgradeQuantity(data, rarity, level);
  return total;
}

/**
 * Ressource d'amélioration : le matériau de l'objet.
 * Un Unique n'a pas de matériau : il utilise celui du palier atteint par son niveau effectif suivant.
 */
export function upgradeResource(data: EquipmentData, item: CatalogItem, upgrade: number): string {
  if (item.material !== null) return item.material;
  const profile = findProfile(data, item.classId, item.slot);
  const family = data.materialFamilies.find((f) => f.id === profile.materialFamily);
  if (!family) throw new Error(`Famille de matériaux inconnue : ${profile.materialFamily}`);
  const nextLevel = Math.min(effectiveLevel(item, upgrade) + 1, data.params.levelCurve.maxLevel);
  let tierIndex = 0;
  data.tiers.forEach((tier, index) => {
    if (tier.baseLevel <= nextLevel) tierIndex = index;
  });
  return family.tiers[tierIndex]!;
}

/** Coût du prochain niveau d'amélioration, ou null si l'objet est au maximum. */
export function nextUpgradeCost(
  data: EquipmentData,
  item: CatalogItem,
  upgrade: number,
): UpgradeCost | null {
  const current = clampUpgrade(item, upgrade);
  if (current >= maxUpgrade(item)) return null;
  return {
    resourceId: upgradeResource(data, item, current),
    quantity: upgradeQuantity(data, item.rarity, current + 1),
  };
}

/** Palier de matériau des objets qui tombent à un étage (bois 1–14, fer 15–29…). */
export function tierForFloor(data: EquipmentData, floor: number): number {
  let tier = data.tiers[0]!.tier;
  for (const t of data.tiers) if (t.unlockFloor <= floor) tier = t.tier;
  return tier;
}
