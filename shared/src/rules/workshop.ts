/**
 * Atelier de fabrication (Village_RPG_Tour.xlsx, onglets Bâtiments et Améliorations) :
 *  - « Niveau 1 : paliers 1 et 2 ; chaque niveau suivant ouvre un palier » ;
 *  - niveau 5 : « −10 % sur toutes les ressources d'amélioration d'objets ».
 * Ces règles sont écrites en texte dans le classeur : elles sont traduites ici.
 */
import { CRAFTING } from '../balance.ts';
import type { EquipmentData, ShopData } from '../data/schemas.ts';
import {
  clampUpgrade,
  effectiveLevel,
  nextUpgradeCost,
  type CatalogItem,
  type UpgradeCost,
} from './equipment.ts';
import { excelRound } from './math.ts';

/** Niveau d'Atelier qui accorde la réduction sur les ressources d'amélioration. */
export const WORKSHOP_DISCOUNT_LEVEL = 5;
export const WORKSHOP_DISCOUNT = 0.1;

/** Palier le plus haut que l'Atelier sait travailler (0 si l'Atelier n'est pas construit). */
export function workshopMaxTier(workshopLevel: number | undefined): number {
  if (!workshopLevel || workshopLevel < 1) return 0;
  return Math.min(5, workshopLevel + 1);
}

/** Palier de matériau d'un objet (pour un Unique : celui de son prochain niveau d'amélioration). */
export function itemWorkTier(data: EquipmentData, item: CatalogItem, upgrade: number): number {
  if (item.tier !== null) return item.tier;
  const nextLevel = Math.min(effectiveLevel(item, upgrade) + 1, data.params.levelCurve.maxLevel);
  let tier = 1;
  for (const t of data.tiers) if (t.baseLevel <= nextLevel) tier = t.tier;
  return tier;
}

/** Coût du prochain niveau d'amélioration à l'Atelier (réduction du niveau 5 comprise). */
export function workshopUpgradeCost(
  data: EquipmentData,
  item: CatalogItem,
  upgrade: number,
  workshopLevel: number,
): UpgradeCost | null {
  const cost = nextUpgradeCost(data, item, clampUpgrade(item, upgrade));
  if (!cost) return null;
  if (workshopLevel < WORKSHOP_DISCOUNT_LEVEL) return cost;
  return { ...cost, quantity: Math.max(1, excelRound(cost.quantity * (1 - WORKSHOP_DISCOUNT))) };
}

/**
 * Fabrication d'un objet Commun +0 (PROPOSITION, absente des classeurs, voir balance.ts) :
 * autant d'unités de son matériau que son prix en boutique en vaut (prix Commun ÷ prix unitaire).
 */
export function craftCost(
  data: { equipment: EquipmentData; shop: ShopData },
  item: CatalogItem,
): UpgradeCost {
  if (item.rarity !== 'common' || item.tier === null || item.material === null) {
    throw new Error(`Seuls les objets Communs se fabriquent (${item.id})`);
  }
  const price = data.shop.equipment.find((e) => e.tier === item.tier)?.prices.common;
  const unit = data.shop.resources.find((r) => r.resourceId === item.material)?.unitPrice;
  if (!price || !unit) throw new Error(`Prix introuvable pour fabriquer ${item.id}`);
  return { resourceId: item.material, quantity: Math.ceil((price / unit) * CRAFTING.costShare) };
}
