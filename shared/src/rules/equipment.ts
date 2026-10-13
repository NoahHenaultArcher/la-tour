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

/** L'amélioration ne peut dépasser le maximum de l'objet (palier ou Unique). */
export function clampUpgrade(item: CatalogItem, upgrade: number): number {
  return Math.min(Math.max(0, Math.round(upgrade)), item.maxUpgrade);
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

export function itemStats(data: EquipmentData, item: CatalogItem, upgrade: number): StatBlock {
  return statsAtLevel(
    data,
    findProfile(data, item.classId, item.slot),
    findRarity(data, item.rarity),
    effectiveLevel(item, upgrade),
  );
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
  if (current >= item.maxUpgrade) return null;
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
