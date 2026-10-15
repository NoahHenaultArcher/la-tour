/** Aide à l'affichage des objets : catalogue, stats, comparaison (aucune règle du jeu ici). */
import {
  STAT_IDS,
  byId,
  heroCombatStats,
  itemStats,
  relicBonus,
  type CharacterDto,
  type ItemDto,
  type RarityId,
  type SaveDto,
  type StatAllocation,
  type StatBlock,
  type StatId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

export type CatalogItem = (typeof gameData.equipment.catalog)[number];

export function catalogItem(catalogId: string): CatalogItem {
  const item = byId(gameData.equipment.catalog, catalogId);
  if (!item) throw new Error(`Objet inconnu : ${catalogId}`);
  return item;
}

export function rarityInfo(rarity: RarityId) {
  return gameData.equipment.rarities.find((r) => r.id === rarity)!;
}

export function statInfo(stat: StatId) {
  return gameData.equipment.stats.find((s) => s.id === stat)!;
}

/** Valeur d'une stat affichée : pourcentage pour les stats en %, nombre sinon. */
export function formatStat(stat: StatId, value: number, signed = false): string {
  const percent = statInfo(stat).unit === 'percent';
  const text = percent
    ? `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
    : Math.round(value).toLocaleString('fr-FR');
  return signed && value > 0 ? `+${text}` : text;
}

export function statsOf(item: ItemDto): StatBlock {
  return itemStats(gameData.equipment, catalogItem(item.catalogId), item.upgradeLevel);
}

/** Différence de stats entre un objet et celui qu'il remplacerait (null : rien d'équipé). */
export function compareStats(candidate: StatBlock, equipped: StatBlock | null) {
  return STAT_IDS.map((id) => ({ id, delta: candidate[id] - (equipped?.[id] ?? 0) })).filter(
    (d) => Math.abs(d.delta) > 1e-9,
  );
}

/** Objet porté par un personnage dans un slot. */
export function equippedIn(save: SaveDto, characterId: string, slot: string): ItemDto | null {
  return save.items.find((i) => i.equippedBy === characterId && i.slot === slot) ?? null;
}

/**
 * Stats de combat d'un personnage (même calcul que le serveur pour le combat).
 * `allocation` permet de prévisualiser une répartition de points pas encore validée.
 */
export function characterStats(
  save: SaveDto,
  character: CharacterDto,
  allocation: StatAllocation = character.statPoints.allocated,
) {
  const equipment = save.items.filter((i) => i.equippedBy === character.id).map(statsOf);
  return heroCombatStats(
    gameData,
    {
      characterId: character.id,
      classId: character.classId,
      level: character.level,
      heritageCount: save.heritageCount,
      equipment,
      deck: character.skills.map((s) => ({ position: s.position, skillId: s.skillId })),
      allocation,
    },
    save.upgradeTower,
    relicBonus(save.relics.filter((r) => r.slot !== null).map((r) => r.relicId)),
  );
}
