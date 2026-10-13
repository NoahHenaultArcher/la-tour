/**
 * Village : production par heure, production idle, coûts d'amélioration, entrepôt, taverne,
 * Tour d'amélioration. Formules de Village_RPG_Tour.xlsx.
 */
import type { UpgradeTowerBranchId } from '../constants.ts';
import type { VillageData } from '../data/schemas.ts';
import { excelRound } from './math.ts';

export type ProductionRow = VillageData['production'][number];
export type BuildingInfo = VillageData['buildings'][number];

const HOUR_MS = 3_600_000;

export function findBuilding(data: VillageData, buildingId: string): BuildingInfo {
  const building = data.buildings.find((b) => b.id === buildingId);
  if (!building) throw new Error(`Bâtiment inconnu : ${buildingId}`);
  return building;
}

/**
 * Production par heure d'une ressource à un niveau du bâtiment :
 * base du palier × (1 + 12 %) ^ (niveau − niveau de déblocage). null si pas encore débloquée ou au-delà du max.
 */
export function productionPerHour(
  data: VillageData,
  row: ProductionRow,
  buildingLevel: number,
): number | null {
  if (buildingLevel < row.requiredBuildingLevel || buildingLevel > row.maxLevel) return null;
  const base = data.params.baseProductionByTier[row.tier - 1]!;
  return excelRound(
    base *
      (1 + data.params.productionGrowthPerLevel) ** (buildingLevel - row.requiredBuildingLevel),
  );
}

/** Production par heure de toutes les ressources d'un bâtiment à un niveau donné. */
export function buildingProduction(
  data: VillageData,
  buildingId: string,
  buildingLevel: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of data.production) {
    if (row.buildingId !== buildingId) continue;
    const perHour = productionPerHour(data, row, buildingLevel);
    if (perHour !== null) result[row.resourceId] = perHour;
  }
  return result;
}

/** Capacité de l'entrepôt par ressource : base × niveau ^ exposant, arrondie à la centaine. */
export function warehouseCapacity(data: VillageData, level: number): number {
  const { baseCapacity, exponent } = data.params.warehouse;
  return excelRound(baseCapacity * level ** exponent, -2);
}

/** Offres et remise de la taverne : +1 objet et +1 lot tous les 2 niveaux, −2 % par niveau. */
export function tavernOffers(
  data: VillageData,
  level: number,
): { items: number; resourceLots: number; discount: number } {
  const t = data.params.tavern;
  const bonus = Math.floor((level - 1) / 2);
  return {
    items: t.itemOffersAtLevel1 + bonus,
    resourceLots: t.resourceLotsAtLevel1 + bonus,
    discount: excelRound((level - 1) * t.discountPerLevel, 4),
  };
}

export interface BuildingUpgradeCost {
  targetLevel: number;
  requiredFloor: number;
  gold: number;
  material: string;
  quantity: number;
  coal: number;
}

/** Tranche de niveau (1–5, 6–10…) d'un niveau de bâtiment. */
function bracketForLevel(data: VillageData, level: number) {
  let bracket = data.params.levelBrackets[0]!;
  for (const b of data.params.levelBrackets) if (b.minLevel <= level) bracket = b;
  return bracket;
}

/** Matériau de construction selon l'étage requis : bois avant 15, puis fer, acier, mithril, adamantite. */
function bracketForFloor(data: VillageData, floor: number) {
  let bracket = data.params.levelBrackets[0]!;
  for (const b of data.params.levelBrackets) if (b.requiredFloor <= floor) bracket = b;
  return bracket;
}

/**
 * Coût pour passer un bâtiment au niveau `targetLevel` (2 ou plus).
 * Étage requis = max(déblocage du bâtiment, tranche du niveau, étage des ressources débloquées à ce niveau),
 * sauf quand le classeur le fixe à la main (Atelier : un palier par niveau ; Tour d'alchimie).
 */
export function buildingUpgradeCost(
  data: VillageData,
  buildingId: string,
  targetLevel: number,
): BuildingUpgradeCost {
  const building = findBuilding(data, buildingId);
  if (
    building.maxLevel === null ||
    building.goldCostCoefficient === null ||
    building.materialMultiplier === null
  ) {
    throw new Error(`Le bâtiment ${buildingId} ne s'améliore pas par niveau.`);
  }
  if (targetLevel < 2 || targetLevel > building.maxLevel) {
    throw new Error(
      `Niveau ${targetLevel} hors limites pour ${buildingId} (max ${building.maxLevel}).`,
    );
  }
  const p = data.params;
  const resourceFloor = Math.max(
    0,
    ...data.production
      .filter((row) => row.buildingId === buildingId && row.requiredBuildingLevel <= targetLevel)
      .map((row) => row.requiredFloor),
  );
  const manual = data.upgrades.find(
    (u) => u.buildingId === buildingId && u.targetLevel === targetLevel && u.requiredFloorIsManual,
  );
  const requiredFloor =
    manual?.requiredFloor ??
    Math.max(building.unlockFloor, bracketForLevel(data, targetLevel).requiredFloor, resourceFloor);
  const quantity = excelRound(
    p.materialBaseQuantity * targetLevel ** p.materialExponent * building.materialMultiplier,
  );
  // Le charbon est demandé dès la 2e tranche d'étage (étage 15, quand la Mine le produit).
  const coalFloor = p.levelBrackets[1]?.requiredFloor ?? Infinity;
  return {
    targetLevel,
    requiredFloor,
    gold: excelRound(building.goldCostCoefficient * (targetLevel - 1) ** p.goldCostExponent, -1),
    material: bracketForFloor(data, requiredFloor).material,
    quantity,
    coal: requiredFloor >= coalFloor ? excelRound(quantity * p.coalShare) : 0,
  };
}

/** Minutes de chasse pour gagner l'or d'une amélioration, dans la meilleure zone disponible à cet étage. */
export function huntingMinutesForGold(data: VillageData, gold: number, floor: number): number {
  const zones = data.params.goldPerHourByZone;
  let zone = zones[0]!;
  for (const z of zones) if (z.zoneFloor <= Math.max(5, floor)) zone = z;
  return excelRound((gold / zone.goldPerHour) * 60, 1);
}

/** Coût d'un niveau de la Tour d'amélioration (identique pour toutes les branches). */
export function upgradeTowerCost(
  data: VillageData,
  level: number,
): { gold: number; ether: number; branchResource: number } {
  const c = data.upgradeTower.cost;
  return {
    gold: excelRound(c.goldCoefficient * level ** c.goldExponent, -3),
    ether: excelRound(c.etherCoefficient * level ** c.resourceExponent),
    branchResource: excelRound(c.branchResourceCoefficient * level ** c.resourceExponent),
  };
}

export interface UpgradeTowerStep {
  branch: UpgradeTowerBranchId;
  /** Niveau visé. */
  level: number;
  gold: number;
  ether: number;
  /** Ressource propre à la branche (adamantite, peau de dragon…) et quantité. */
  resourceId: string;
  branchResource: number;
}

/** Prochain niveau d'une branche de la Tour d'amélioration (null au niveau maximum). */
export function nextUpgradeTowerStep(
  data: VillageData,
  levels: Partial<Record<UpgradeTowerBranchId, number>>,
  branch: UpgradeTowerBranchId,
): UpgradeTowerStep | null {
  const info = data.upgradeTower.branches.find((b) => b.id === branch);
  if (!info) return null;
  const level = (levels[branch] ?? 0) + 1;
  if (level > info.maxLevel) return null;
  return { branch, level, ...upgradeTowerCost(data, level), resourceId: info.resourceId };
}

export interface IdleStock {
  amount: number;
  /** Part de ressource produite mais pas encore entière. */
  fraction: number;
}

export interface IdleInput {
  /** Horloge du serveur (jamais celle du client). */
  now: Date;
  lastCollectedAt: Date;
  /** Production par heure de chaque ressource (somme des bâtiments). */
  ratesPerHour: Record<string, number>;
  stocks: Record<string, IdleStock>;
  /** Capacité de l'entrepôt par ressource. */
  capacity: number;
  /** Durée maximale de production hors ligne, en heures (8 h + bonus de la Tour d'amélioration). */
  maxHours: number;
  /** Bonus de production (Tour d'amélioration : +5 % par niveau), ex. 0,1 pour +10 %. */
  productionBonus?: number;
}

export interface IdleResult {
  /** Heures réellement comptées (plafonnées). */
  hours: number;
  produced: Record<string, number>;
  stocks: Record<string, IdleStock>;
}

/**
 * Production idle depuis la dernière collecte : continue même hors ligne, plafonnée à `maxHours`,
 * et par la capacité de l'entrepôt. Un stock déjà au-dessus du plafond (butin, achat) n'est jamais réduit.
 */
export function computeIdleProduction(input: IdleInput): IdleResult {
  const elapsed = (input.now.getTime() - input.lastCollectedAt.getTime()) / HOUR_MS;
  const hours = Math.min(Math.max(0, elapsed), input.maxHours);
  const multiplier = 1 + (input.productionBonus ?? 0);
  const produced: Record<string, number> = {};
  const stocks: Record<string, IdleStock> = { ...input.stocks };

  for (const [resourceId, rate] of Object.entries(input.ratesPerHour)) {
    const stock = input.stocks[resourceId] ?? { amount: 0, fraction: 0 };
    if (stock.amount >= input.capacity) {
      stocks[resourceId] = { amount: stock.amount, fraction: 0 };
      produced[resourceId] = 0;
      continue;
    }
    const exact = rate * multiplier * hours + stock.fraction;
    const whole = Math.floor(exact);
    const amount = Math.min(input.capacity, stock.amount + whole);
    stocks[resourceId] = { amount, fraction: amount === input.capacity ? 0 : exact - whole };
    produced[resourceId] = amount - stock.amount;
  }
  return { hours, produced, stocks };
}

/** Niveau de chaque bâtiment construit (bâtiments absents = pas encore débloqués). */
export type BuildingLevels = Record<string, number>;
/** Niveau de chaque branche de la Tour d'amélioration. */
export type UpgradeTowerLevels = Partial<Record<UpgradeTowerBranchId, number>>;

/** Bonus total d'une branche de la Tour d'amélioration (niveau × bonus par niveau). */
export function upgradeTowerBonus(
  data: VillageData,
  levels: UpgradeTowerLevels,
  branch: UpgradeTowerBranchId,
): number {
  const info = data.upgradeTower.branches.find((b) => b.id === branch);
  return (levels[branch] ?? 0) * (info?.bonusPerLevel ?? 0);
}

export interface VillageIdleSettings {
  /** Production par heure de chaque ressource, avant bonus. */
  ratesPerHour: Record<string, number>;
  capacity: number;
  maxHours: number;
  productionBonus: number;
}

/** Paramètres de la production idle d'un village : production, entrepôt, durée hors ligne, bonus. */
export function villageIdleSettings(
  data: VillageData,
  buildings: BuildingLevels,
  tower: UpgradeTowerLevels = {},
): VillageIdleSettings {
  const ratesPerHour: Record<string, number> = {};
  for (const [buildingId, level] of Object.entries(buildings)) {
    for (const [resourceId, rate] of Object.entries(buildingProduction(data, buildingId, level))) {
      ratesPerHour[resourceId] = (ratesPerHour[resourceId] ?? 0) + rate;
    }
  }
  return {
    ratesPerHour,
    capacity: warehouseCapacity(data, buildings.entrepot ?? 1),
    maxHours: data.params.maxOfflineHours + upgradeTowerBonus(data, tower, 'offlineDuration'),
    productionBonus: upgradeTowerBonus(data, tower, 'production'),
  };
}

export interface NextUpgrade {
  cost: BuildingUpgradeCost;
  /** Effet du niveau visé, tel qu'écrit dans le classeur (onglet Améliorations). */
  effect: string;
}

/** Prochaine amélioration d'un bâtiment, ou null s'il est au maximum ou ne s'améliore pas. */
export function nextBuildingUpgrade(
  data: VillageData,
  buildingId: string,
  currentLevel: number,
): NextUpgrade | null {
  const row = data.upgrades.find(
    (u) => u.buildingId === buildingId && u.targetLevel === currentLevel + 1,
  );
  if (!row) return null;
  return { cost: buildingUpgradeCost(data, buildingId, currentLevel + 1), effect: row.effect };
}

export interface UpgradeShortfall {
  /** Vrai si l'étage requis n'est pas encore terminé. */
  floor: boolean;
  gold: number;
  material: number;
  coal: number;
}

/** Ce qui manque pour payer une amélioration (0 partout et floor=false : amélioration possible). */
export function upgradeShortfall(
  cost: BuildingUpgradeCost,
  owned: { gold: number; resources: Record<string, number>; floorCleared: number },
): UpgradeShortfall {
  const stock = (id: string) => owned.resources[id] ?? 0;
  return {
    floor: owned.floorCleared < cost.requiredFloor,
    gold: Math.max(0, cost.gold - owned.gold),
    material: Math.max(0, cost.quantity - stock(cost.material)),
    coal: Math.max(0, cost.coal - stock('charbon')),
  };
}

export function canAfford(shortfall: UpgradeShortfall): boolean {
  return (
    !shortfall.floor && shortfall.gold === 0 && shortfall.material === 0 && shortfall.coal === 0
  );
}
