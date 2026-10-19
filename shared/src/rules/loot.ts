/**
 * Butin (bestiaire, onglet Butin) :
 *  1. pour chaque monstre vaincu, tirage de la chance de butin de son rang ;
 *  2. si réussi : le nombre d'objets du rang (+1 avec la chance d'objet bonus) ;
 *  3. pour chaque objet : une classe au hasard (les trois, même hors de l'équipe), une rareté tirée
 *     dans la table du biome (monstres, boss ou dragon), un slot au hasard, le matériau du palier de l'étage, amélioration +0.
 *  Uniques : seuls les boss et les dragons en lâchent, chacun un Unique précis (uniqueForBossFloor) ;
 *  un autre monstre ne tire jamais la rareté Unique.
 * Abysse : tables du dernier biome (palier adamantite), Mythique et Légendaire plus fréquents avec la
 * profondeur, Unique de l'étage d'origine du boss ou du dragon, butin garanti sur un alpha.
 */
import { CLASS_IDS, RARITY_IDS, SLOT_IDS, type ClassId, type RarityId } from '../constants.ts';
import type { ElementsData, EquipmentData, LootData, MonstersData } from '../data/schemas.ts';
import { ABYSS } from '../balance.ts';
import { abyssHighRarityBoost } from './abyss.ts';
import { tierForFloor, type CatalogItem } from './equipment.ts';
import { chance, nextFloat, pick, type Rng } from './random.ts';
import { byId } from './lookup.ts';

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

/** Rareté tirée selon des poids (pas forcément de somme 1). */
export function weightedRarity(rng: Rng, weights: Record<RarityId, number>): RarityId {
  const total = RARITY_IDS.reduce((sum, id) => sum + weights[id], 0);
  let roll = nextFloat(rng) * total;
  for (const id of RARITY_IDS) {
    roll -= weights[id];
    if (roll < 0) return id;
  }
  return 'common';
}

const dropsUnique = (rank: string) => rank === 'boss' || rank === 'dragon';

/**
 * Unique lâché par le boss ou le dragon d'un étage (décision du 19/10/2026) : chaque biome a 3 Uniques
 * (un par classe) et 3 étages de boss ou de dragon ; dans l'ordre des étages, ils donnent l'Unique du
 * Guerrier, du Mage puis du Tireur (Forêt : 5 → Guerrier, 9 → Mage, 10 → Tireur).
 * null si l'étage n'a ni boss ni dragon.
 */
export function uniqueForBossFloor(
  data: Pick<LootRulesData, 'loot' | 'equipment' | 'elements' | 'monsters'>,
  floor: number,
): CatalogItem | null {
  const biome = biomeOfFloor(data, floor);
  const bossFloors = [
    ...new Set(
      data.monsters.monsters
        .filter(
          (m) =>
            dropsUnique(m.rank) && m.zoneFloor >= biome.floorMin && m.zoneFloor <= biome.floorMax,
        )
        .map((m) => m.zoneFloor),
    ),
  ].sort((a, b) => a - b);
  const classId = CLASS_IDS[bossFloors.indexOf(floor)];
  if (!classId) return null;
  const entry = data.loot.uniquesByBiome.find((u) => u.biome === biome.id);
  const unique = data.equipment.uniques.find(
    (u) => u.classId === classId && u.name === entry?.uniques[classId],
  );
  if (!unique) throw new Error(`Unique introuvable (${biome.id}, ${classId})`);
  return data.equipment.catalog.find((c) => c.id === unique.id) ?? null;
}

/** Étage du boss ou du dragon qui lâche un Unique (null pour un autre objet). */
export function bossFloorOfUnique(
  data: Pick<LootRulesData, 'loot' | 'equipment' | 'elements' | 'monsters'>,
  catalogId: string,
): number | null {
  const floors = data.monsters.monsters.filter((m) => dropsUnique(m.rank)).map((m) => m.zoneFloor);
  return floors.find((floor) => uniqueForBossFloor(data, floor)?.id === catalogId) ?? null;
}

/** Objet du catalogue (hors Unique) correspondant à un tirage. */
export function catalogItemFor(
  data: LootRulesData,
  classId: ClassId,
  rarity: RarityId,
  floor: number,
  rng: Rng,
): string {
  const slot = pick(rng, SLOT_IDS);
  const tier = tierForFloor(data.equipment, floor);
  const item = data.equipment.catalog.find(
    (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
  );
  if (!item) throw new Error(`Objet introuvable (${classId}, ${slot}, palier ${tier}, ${rarity})`);
  return item.id;
}

/**
 * Butin d'un combat (solo : un seul tirage pour l'équipe ;
 * la classe de chaque objet est tirée parmi `classes` ; le serveur passe les trois classes).
 */
export function rollLoot(
  data: LootRulesData,
  rng: Rng,
  /** `alpha` : monstre alpha (vrai ou son trait), butin garanti. */
  killed: readonly { monsterId: string; alpha?: boolean | string }[],
  floor: number,
  classes: readonly ClassId[],
  /** Étage de l'Abysse (`floor` est alors ignoré pour le palier et les tables). */
  options: { abyssFloor?: number } = {},
): LootDrop[] {
  if (classes.length === 0) return [];
  const { abyssFloor } = options;
  const lootFloor = abyssFloor ? ABYSS.unlockFloor : floor;
  const biome = biomeOfFloor(data, lootFloor);
  const drops: LootDrop[] = [];
  for (const { monsterId, alpha } of killed) {
    const monster = byId(data.monsters.monsters, monsterId);
    const rule = monster && data.loot.dropByRank.find((r) => r.rank === monster.rank);
    if (!rule || !chance(rng, alpha ? 1 : rule.dropChance)) continue;
    const count = rule.itemsPerDrop + (chance(rng, rule.bonusItemChance) ? 1 : 0);
    const table = data.loot.rarityTables[rule.rarityTable].find((t) => t.biome === biome.id);
    if (!table) continue;
    // Seuls les boss et les dragons lâchent un Unique : le leur, celui de leur étage d'origine
    // (le même que l'étage joué dans la tour ; dans l'Abysse, l'étage de la tour d'où ils viennent).
    const unique = dropsUnique(monster.rank) ? uniqueForBossFloor(data, monster.zoneFloor) : null;
    const tableWeights = unique ? table.weights : { ...table.weights, unique: 0 };
    const weights = abyssFloor ? boostHighRarities(tableWeights, abyssFloor) : tableWeights;
    for (let i = 0; i < count; i++) {
      const classId = pick(rng, classes);
      const rarity = weightedRarity(rng, weights);
      drops.push(
        rarity === 'unique' && unique
          ? { classId: unique.classId, rarity, catalogId: unique.id }
          : { classId, rarity, catalogId: catalogItemFor(data, classId, rarity, lootFloor, rng) },
      );
    }
  }
  return drops;
}

/** Abysse : chances de Mythique et Légendaire multipliées selon la profondeur. */
function boostHighRarities(
  weights: Record<RarityId, number>,
  abyssFloor: number,
): Record<RarityId, number> {
  const boost = abyssHighRarityBoost(abyssFloor);
  return { ...weights, mythic: weights.mythic * boost, legendary: weights.legendary * boost };
}
