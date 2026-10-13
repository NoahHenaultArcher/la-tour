/**
 * Taverne (bestiaire, onglet Boutique) :
 *  - assortiment renouvelé toutes les heures (heure réelle, même hors ligne) ;
 *  - 6 objets et 4 lots de ressources au niveau 1, +1 de chaque tous les 2 niveaux, remise par niveau
 *    sur tous les prix (Village › Paramètres §4) ;
 *  - objets : Commun à Épique, +0, classes possédées, paliers déjà débloqués ;
 *  - lots de 10 ressources des paliers débloqués ; toile, verre et cuivre toujours en vente ;
 *  - personnages : classes non possédées, prix du 2e puis du 3e ;
 *  - revente : 20 % du prix boutique de la rareté (Mythique et plus : base du prix Épique).
 * La rareté des objets vendus suit la table « monstres » du biome atteint, limitée à Commun → Épique
 * (le classeur ne précise pas ce tirage).
 */
import { RARITY_IDS, SLOT_IDS, type ClassId, type RarityId } from '../constants.ts';
import type {
  ElementsData,
  EquipmentData,
  LootData,
  ResourcesData,
  ShopData,
  VillageData,
} from '../data/schemas.ts';
import type { CatalogItem } from './equipment.ts';
import { biomeOfFloor } from './loot.ts';
import { excelRound } from './math.ts';
import { createRng, nextFloat, pick } from './random.ts';
import { tavernOffers } from './village.ts';
import { itemWorkTier } from './workshop.ts';

export interface ShopRulesData {
  shop: ShopData;
  equipment: EquipmentData;
  village: VillageData;
  loot: LootData;
  elements: ElementsData;
  resources: ResourcesData;
}

type ShopRarity = 'common' | 'rare' | 'superRare' | 'epic';
const SHOP_RARITIES: ShopRarity[] = ['common', 'rare', 'superRare', 'epic'];

export interface ItemOffer {
  offerId: string;
  catalogId: string;
  price: number;
}

export interface LotOffer {
  offerId: string;
  resourceId: string;
  quantity: number;
  price: number;
}

export interface CharacterOffer {
  offerId: string;
  classId: ClassId;
  price: number;
}

export interface ShopOffers {
  discount: number;
  items: ItemOffer[];
  /** Lots tirés au hasard (un achat chacun). */
  lots: LotOffer[];
  /** Ressources vendues seulement à la taverne : toujours disponibles. */
  permanentLots: LotOffer[];
  characters: CharacterOffer[];
}

export interface ShopContext {
  seed: number;
  ownedClasses: readonly ClassId[];
  /** Meilleur étage atteint (les paliers et ressources déjà débloqués restent en vente). */
  bestFloor: number;
  tavernLevel: number;
}

/** Numéro de la tranche horaire du renouvellement. */
export function shopPeriod(data: { shop: ShopData }, now: Date): number {
  return Math.floor(now.getTime() / (data.shop.settings.refreshMinutes * 60_000));
}

/** Début de la tranche suivante (prochain renouvellement). */
export function nextShopRefresh(data: { shop: ShopData }, now: Date): Date {
  const period = data.shop.settings.refreshMinutes * 60_000;
  return new Date((shopPeriod(data, now) + 1) * period);
}

const discounted = (price: number, discount: number) => excelRound(price * (1 - discount));

export function generateShop(data: ShopRulesData, context: ShopContext): ShopOffers {
  // Deux tirages séparés : améliorer la taverne en cours d'heure ajoute des offres
  // à la fin de chaque liste sans changer celles déjà affichées (ni celles déjà achetées).
  const rng = createRng(context.seed);
  const lotRng = createRng((context.seed ^ 0x5bd1e995) >>> 0);
  const {
    items: itemCount,
    resourceLots,
    discount,
  } = tavernOffers(data.village, context.tavernLevel);
  const floor = Math.min(100, Math.max(1, context.bestFloor));
  const settings = data.shop.settings;

  // Objets.
  const tiers = data.equipment.tiers.filter((t) => t.unlockFloor <= floor).map((t) => t.tier);
  const table = data.loot.rarityTables.monsters.find(
    (t) => t.biome === biomeOfFloor(data, floor).id,
  );
  const weights = SHOP_RARITIES.map((r) => table?.weights[r] ?? 0);
  const total = weights.reduce((a, b) => a + b, 0);
  const pickRarity = (): ShopRarity => {
    let roll = nextFloat(rng) * total;
    for (let i = 0; i < SHOP_RARITIES.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return SHOP_RARITIES[i]!;
    }
    return 'common';
  };
  const items: ItemOffer[] = [];
  if (context.ownedClasses.length > 0) {
    for (let i = 0; i < itemCount; i++) {
      const classId = pick(rng, context.ownedClasses);
      const tier = pick(rng, tiers);
      const slot = pick(rng, SLOT_IDS);
      const rarity = pickRarity();
      const item = data.equipment.catalog.find(
        (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
      )!;
      const price = data.shop.equipment.find((e) => e.tier === tier)!.prices[rarity];
      items.push({ offerId: `item-${i}`, catalogId: item.id, price: discounted(price, discount) });
    }
  }

  // Lots de ressources.
  const lot = (offerId: string, resourceId: string): LotOffer => ({
    offerId,
    resourceId,
    quantity: settings.unitsPerLot,
    price: discounted(
      data.shop.resources.find((r) => r.resourceId === resourceId)!.lotPrice,
      discount,
    ),
  });
  const tavernOnly = new Set(
    data.resources.resources.filter((r) => r.source === 'taverne').map((r) => r.id),
  );
  const pool = data.shop.resources
    .filter((r) => r.unlockFloor <= floor && !tavernOnly.has(r.resourceId))
    .map((r) => r.resourceId);
  const lots: LotOffer[] = [];
  for (let i = 0; i < resourceLots && pool.length > 0; i++) {
    const index = Math.floor(nextFloat(lotRng) * pool.length);
    const [resourceId] = pool.splice(index, 1);
    lots.push(lot(`lot-${i}`, resourceId!));
  }
  const permanentLots = [...tavernOnly].map((id) => lot(`always-${id}`, id));

  // Personnages : le prix dépend du nombre de personnages déjà possédés.
  const nextPurchase = context.ownedClasses.length + 1;
  const characterPrice = data.shop.characters.find((c) => c.purchaseNumber === nextPurchase)?.price;
  const characters: CharacterOffer[] =
    characterPrice === undefined
      ? []
      : (['warrior', 'mage', 'ranger'] as ClassId[])
          .filter((c) => !context.ownedClasses.includes(c))
          .map((classId) => ({
            offerId: `class-${classId}`,
            classId,
            price: discounted(characterPrice, discount),
          }));

  return { discount, items, lots, permanentLots, characters };
}

/** Prix de revente : 20 % du prix boutique de la rareté (Mythique et plus : prix Épique). */
export function sellPrice(
  data: { shop: ShopData; equipment: EquipmentData },
  item: CatalogItem,
  upgrade: number,
): number {
  const tier = itemWorkTier(data.equipment, item, upgrade);
  const rarity: ShopRarity = SHOP_RARITIES.includes(item.rarity as ShopRarity)
    ? (item.rarity as ShopRarity)
    : 'epic';
  const price = data.shop.equipment.find((e) => e.tier === tier)!.prices[rarity];
  return excelRound(price * data.shop.settings.resaleRatio);
}

/** Rareté vendue ou non par la taverne (Mythique, Légendaire et Unique ne le sont jamais). */
export function isSoldAtTavern(rarity: RarityId): boolean {
  return RARITY_IDS.indexOf(rarity) <= RARITY_IDS.indexOf('epic');
}
