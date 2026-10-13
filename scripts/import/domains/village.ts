import path from 'node:path';
import type { VillageData } from '@la-tour/shared/schemas';
import type { ImportContext } from '../context.ts';
import { UPGRADE_TOWER_BRANCHES, fromLabel, slugify } from '../labels.ts';
import { ImportError } from '../workbook.ts';

const MAX_BUILDING_LEVEL_COLUMNS = 25;

export function importVillage({ books, images }: ImportContext): VillageData {
  const buildingsSheet = books.village.sheet('Bâtiments');
  const buildings = buildingsSheet.table('Bâtiment').map((row) => {
    const imageFile = row.text('Image');
    const id = path.posix.basename(imageFile, path.posix.extname(imageFile));
    return {
      id,
      name: row.text('Bâtiment'),
      image: images.get('village', id),
      type: row.text('Type'),
      unlockFloor: row.int("Débloqué à l'étage"),
      maxLevel: row.optInt('Niveau max'),
      goldCostCoefficient: row.optNum('Coût en or (coefficient)'),
      materialMultiplier: row.optNum('Multiplicateur de matériaux'),
      role: row.text('Rôle'),
    };
  });
  const buildingIdByName = new Map(buildings.map((b) => [b.name, b.id]));
  const buildingId = (name: string, where: string) => {
    const id = buildingIdByName.get(name);
    if (!id) throw new ImportError(`${where} : bâtiment « ${name} » absent de l'onglet Bâtiments.`);
    return id;
  };

  const productionSheet = books.village.sheet('Production');
  const production = productionSheet.table('Bâtiment').map((row) => {
    const where = `${productionSheet.where} ligne ${row.index}`;
    const perLevel: (number | null)[] = [];
    for (let level = 1; level <= MAX_BUILDING_LEVEL_COLUMNS; level++)
      perLevel.push(row.optInt(`Niv. ${level}`));
    return {
      buildingId: buildingId(row.text('Bâtiment'), where),
      resourceId: slugify(row.text('Ressource')),
      tier: row.int('Palier'),
      requiredBuildingLevel: row.int('Niveau du bâtiment requis'),
      requiredFloor: row.int('Étage requis'),
      baseProductionPerHour: row.num('Production de base (/h)'),
      perLevel,
      maxLevel: row.int('Niveau max'),
    };
  });

  const upgradesSheet = books.village.sheet('Améliorations');
  const upgrades = upgradesSheet.table('Bâtiment').map((row) => ({
    buildingId: buildingId(row.text('Bâtiment'), `${upgradesSheet.where} ligne ${row.index}`),
    targetLevel: row.int('Niveau visé'),
    requiredFloor: row.int('Étage requis'),
    // Atelier et Tour d'alchimie : étage saisi à la main (pas de formule dans le classeur).
    requiredFloorIsManual: !row.isFormula('Étage requis'),
    gold: row.int('Or'),
    material: slugify(row.text('Matériau')),
    quantity: row.int('Quantité'),
    coal: row.int('Charbon'),
    huntingMinutes: row.num("Minutes de chasse pour l'or"),
    effect: row.text('Effet du niveau visé'),
  }));

  const params = books.village.sheet('Paramètres');
  const levelBrackets = params.table('Tranche', { count: 5 }).map((row) => ({
    minLevel: row.int('Niveau min'),
    maxLevel: row.int('Niveau max'),
    material: slugify(row.text('Matériau de construction')),
    requiredFloor: row.int('Étage requis'),
  }));
  // Le tableau est suivi d'une note, sans ligne vide entre les deux.
  const goldPerHourByZone = params
    .table('Étage de la zone', { until: (row) => row.raw('Or / heure') === null })
    .map((row) => ({
      zoneFloor: row.int('Étage de la zone'),
      goldPerHour: row.num('Or / heure'),
      zoneName: row.text('Zone'),
    }));

  const tower = books.village.sheet("Tour d'amélioration");
  const branches = tower.table('Branche', { count: 6 }).map((row) => ({
    id: fromLabel(UPGRADE_TOWER_BRANCHES, row.text('Branche'), tower.where),
    name: row.text('Branche'),
    bonusPerLevel: row.num('Bonus par niveau'),
    unit: row.text('Unité'),
    maxLevel: row.int('Niveau max'),
    resourceId: slugify(row.text('Ressource de la branche')),
    effect: row.text('Effet'),
  }));
  const towerLevels = tower.table('Niveau visé').map((row) => ({
    level: row.int('Niveau visé'),
    gold: row.int('Or'),
    ether: row.int('Éther'),
    branchResource: row.int('Ressource de branche'),
    huntingMinutes: row.num('Minutes de chasse (étage 100)'),
  }));

  return {
    buildings,
    production,
    upgrades,
    params: {
      baseProductionByTier: [1, 2, 3, 4, 5].map((tier) =>
        params.param(`Production de base d'une ressource de palier ${tier} (/h)`),
      ),
      productionGrowthPerLevel: params.param('Hausse de production par niveau du bâtiment'),
      maxOfflineHours: params.param('Durée maximale de production hors ligne (h)'),
      goldCostExponent: params.param('Exposant du coût en or'),
      materialBaseQuantity: params.param('Matériau de construction : quantité de base'),
      materialExponent: params.param('Matériau de construction : exposant'),
      coalShare: params.param('Charbon demandé (part de la quantité de matériau)'),
      levelBrackets,
      warehouse: {
        baseCapacity: params.param('Entrepôt : capacité de base par ressource'),
        exponent: params.param('Entrepôt : exposant'),
      },
      tavern: {
        itemOffersAtLevel1: params.param('Taverne : objets proposés au niveau 1'),
        resourceLotsAtLevel1: params.param('Taverne : lots de ressources au niveau 1'),
        discountPerLevel: params.param('Taverne : remise par niveau'),
      },
      goldPerHourByZone,
    },
    upgradeTower: {
      branches,
      cost: {
        goldCoefficient: tower.param('Or : coefficient'),
        goldExponent: tower.param('Or : exposant'),
        etherCoefficient: tower.param('Éther : coefficient'),
        branchResourceCoefficient: tower.param('Ressource de branche : coefficient'),
        resourceExponent: tower.param('Exposant des ressources'),
      },
      levels: towerLevels,
    },
  };
}
