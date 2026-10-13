/**
 * Butin (bestiaire, onglet Butin) :
 *  1. pour chaque monstre vaincu, tirage de la chance de butin de son rang ;
 *  2. si réussi : le nombre d'objets du rang (+1 avec la chance d'objet bonus) ;
 *  3. pour chaque objet : une classe de l'équipe au hasard, une rareté tirée dans la table du biome
 *     (monstres, boss ou dragon), un slot au hasard, le matériau du palier de l'étage, amélioration +0.
 *  Si la rareté tirée est Unique : l'Unique du biome pour cette classe.
 */
import { RARITY_IDS, SLOT_IDS, type ClassId, type RarityId } from '../constants.ts';
import type { ElementsData, EquipmentData, LootData, MonstersData } from '../data/schemas.ts';
import { tierForFloor } from './equipment.ts';
import { chance, nextFloat, pick, type Rng } from './random.ts';

export interface LootRulesData {
  loot: LootData;
  equipment: EquipmentData;
  elements: ElementsData;
  monsters: MonstersData;
}

export interface LootDrop {
  catalogId: string;
  classId: ClassId;
  rarity: RarityId;
}

/** Biome d'un étage (ou d'une zone de chasse, d'après l'étage de la zone). */
export function biomeOfFloor(data: { elements: ElementsData }, floor: number) {
  const biome = data.elements.biomes.find((b) => floor >= b.floorMin && floor <= b.floorMax);
  if (!biome) throw new Error(`Aucun biome pour l'étage ${floor}`);
  return biome;
}

function weightedRarity(rng: Rng, weights: Record<RarityId, number>): RarityId {
  const total = RARITY_IDS.reduce((sum, id) => sum + weights[id], 0);
  let roll = nextFloat(rng) * total;
  for (const id of RARITY_IDS) {
    roll -= weights[id];
    if (roll < 0) return id;
  }
  return 'common';
}

/** Objet du catalogue correspondant à un tirage. */
export function catalogItemFor(
  data: LootRulesData,
  classId: ClassId,
  rarity: RarityId,
  floor: number,
  rng: Rng,
): string {
  if (rarity === 'unique') {
    const biome = biomeOfFloor(data, floor);
    const entry = data.loot.uniquesByBiome.find((u) => u.biome === biome.id);
    const unique = data.equipment.uniques.find(
      (u) => u.classId === classId && u.name === entry?.uniques[classId],
    );
    if (!unique) throw new Error(`Unique introuvable (${biome.id}, ${classId})`);
    return unique.id;
  }
  const slot = pick(rng, SLOT_IDS);
  const tier = tierForFloor(data.equipment, floor);
  const item = data.equipment.catalog.find(
    (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
  );
  if (!item) throw new Error(`Objet introuvable (${classId}, ${slot}, palier ${tier}, ${rarity})`);
  return item.id;
}

/**
 * Butin d'un combat pour une équipe (solo : un seul tirage pour l'équipe ;
 * la classe de chaque objet est tirée parmi celles de l'équipe).
 */
export function rollLoot(
  data: LootRulesData,
  rng: Rng,
  killed: readonly { monsterId: string }[],
  floor: number,
  classes: readonly ClassId[],
): LootDrop[] {
  if (classes.length === 0) return [];
  const biome = biomeOfFloor(data, floor);
  const drops: LootDrop[] = [];
  for (const { monsterId } of killed) {
    const monster = data.monsters.monsters.find((m) => m.id === monsterId);
    const rule = monster && data.loot.dropByRank.find((r) => r.rank === monster.rank);
    if (!rule || !chance(rng, rule.dropChance)) continue;
    const count = rule.itemsPerDrop + (chance(rng, rule.bonusItemChance) ? 1 : 0);
    const table = data.loot.rarityTables[rule.rarityTable].find((t) => t.biome === biome.id);
    if (!table) continue;
    for (let i = 0; i < count; i++) {
      const classId = pick(rng, classes);
      const rarity = weightedRarity(rng, table.weights);
      drops.push({ classId, rarity, catalogId: catalogItemFor(data, classId, rarity, floor, rng) });
    }
  }
  return drops;
}
