import { RARITY_IDS, STAT_IDS, type RarityId, type StatBlock } from '@la-tour/shared';
import type { EquipmentData, FixturesData } from '@la-tour/shared/schemas';
import { readLevelCurve, type ImportContext } from '../context.ts';
import {
  BIOMES,
  CLASSES,
  ELEMENTS,
  RARITIES,
  RARITY_FRAME_IDS,
  SLOTS,
  STATS,
  fromLabel,
  labelOf,
  slugify,
} from '../labels.ts';
import { ImportError, type Row } from '../workbook.ts';

function readStats(row: Row, occurrence = 0): StatBlock {
  const block = {} as StatBlock;
  for (const id of STAT_IDS) block[id] = row.num(labelOf(STATS, id), occurrence);
  return block;
}

export function importEquipment({ books, images }: ImportContext): {
  data: EquipmentData;
  fixtures: Pick<FixturesData, 'equipmentProgression' | 'fullSet' | 'upgradeCosts'>;
} {
  const params = books.equipment.sheet('Paramètres');

  const rarities = params.table('Rareté', { count: RARITY_IDS.length }).map((row) => {
    const id = fromLabel(RARITIES, row.text('Rareté'), params.where);
    const frameId = RARITY_FRAME_IDS[id];
    const color = images.frameColors.get(frameId);
    if (!color) throw new ImportError(`manifest.json : couleur du cadre « ${frameId} » absente.`);
    return {
      id,
      name: row.text('Rareté'),
      order: row.int('N°'),
      statMultiplier: row.num('Multiplicateur de stats'),
      statLines: row.int('Lignes de stats débloquées'),
      hasPassive: row.yesNo('Passif'),
      naming: row.text("Nom de l'objet"),
      dropInfo: row.text('Obtention (butin)'),
      upgradeCostMultiplier: row.num("Coût d'amélioration ×"),
      color,
      frameImage: images.get('cadre', frameId),
    };
  });

  const stats = params.table('Statistique', { count: STAT_IDS.length }).map((row) => {
    const unit = row.text('Unité');
    return {
      id: fromLabel(STATS, row.text('Statistique'), params.where),
      name: row.text('Statistique'),
      category: row.text('Catégorie'),
      unit: unit === '%' ? ('percent' as const) : ('points' as const),
      referenceValue: row.num('Valeur de référence K'),
      decimals: row.int('Décimales'),
      recommendedCap: row.optNum('Plafond conseillé (total équipement)'),
      notes: row.text('Rôle / notes'),
    };
  });

  const materials = books.equipment.sheet('Matériaux');
  const materialFamilies = materials.table('Famille').map((row) => ({
    id: slugify(row.text('Famille')),
    name: row.text('Famille'),
    tiers: [1, 2, 3, 4, 5].map((tier) => slugify(row.text(`Palier ${tier}`))),
    usedFor: row.text('Utilisé pour'),
  }));
  const familyByName = new Map(materialFamilies.map((f) => [f.name, f]));

  const tiers = materials.table('Palier', { count: 5 }).map((row) => ({
    tier: row.int('Palier'),
    baseLevel: row.int('Niveau de base (amélioration 0)'),
    maxUpgrade: row.int('Amélioration max'),
    maxEffectiveLevel: row.int('Niveau effectif max'),
    unlockFloor: row.int("Ressource débloquée à l'étage"),
  }));

  const profilesSheet = books.equipment.sheet('Profils');
  const profiles = profilesSheet.table('Clé').map((row) => {
    const familyName = row.text('Famille de matériaux');
    const family = familyByName.get(familyName);
    if (!family)
      throw new ImportError(
        `${profilesSheet.where} ligne ${row.index} : famille « ${familyName} » inconnue.`,
      );
    return {
      classId: fromLabel(CLASSES, row.text('Classe'), profilesSheet.where),
      slot: fromLabel(SLOTS, row.text('Slot'), profilesSheet.where),
      itemType: row.text("Type d'objet"),
      materialFamily: family.id,
      weights: readStats(row, 0),
      ranks: readStats(row, 1),
    };
  });

  const catalogSheet = books.equipment.sheet('Catalogue');
  const displayedUpgrade = catalogSheet.valueAt('C3');
  if (displayedUpgrade !== 0) {
    throw new ImportError(
      `${catalogSheet.where} : la cellule C3 (niveau d'amélioration affiché) doit valoir 0 pour importer les stats de base, trouvé « ${String(displayedUpgrade)} ».`,
    );
  }
  const catalog = catalogSheet.table('ID').map((row) => {
    const where = `${catalogSheet.where} ligne ${row.index}`;
    const id = row.text('ID');
    const rarity = fromLabel(RARITIES, row.text('Rareté'), where);
    const material = row.optText('Matériau');
    const nextCost = row.raw('Coût du niveau suivant');
    if (typeof nextCost !== 'number')
      throw new ImportError(
        `${where} : coût du niveau suivant attendu, trouvé « ${String(nextCost)} ».`,
      );
    if (row.int('Amélioration') !== 0)
      throw new ImportError(`${where} : l'objet devrait être affiché à +0.`);
    const element = row.optText('Élément');
    return {
      id,
      classId: fromLabel(CLASSES, row.text('Classe'), where),
      slot: fromLabel(SLOTS, row.text('Slot'), where),
      rarity,
      tier: row.optInt('Palier'),
      material: material === null ? null : slugify(material),
      name: row.text('Nom'),
      baseLevel: row.int('Niveau de base'),
      maxUpgrade: row.int('(aide) Amélioration max'),
      element: element === null ? null : fromLabel(ELEMENTS, element, where),
      statsAtZero: readStats(row),
      powerAtZero: row.num('Puissance (pts)'),
      upgradeResourceAtZero: slugify(row.text("Ressource d'amélioration")),
      upgradeCostToOne: nextCost,
      image: images.get('equipement', id),
    };
  });

  const uniquesSheet = books.equipment.sheet('Uniques');
  const uniques = uniquesSheet.table('Clé').map((row) => {
    const where = `${uniquesSheet.where} ligne ${row.index}`;
    const classId = fromLabel(CLASSES, row.text('Classe'), where);
    const slot = fromLabel(SLOTS, row.text('Slot'), where);
    const item = catalog.find(
      (c) => c.classId === classId && c.slot === slot && c.rarity === 'unique',
    );
    if (!item)
      throw new ImportError(`${where} : Unique absent du Catalogue (${classId}, ${slot}).`);
    return {
      id: item.id,
      classId,
      slot,
      itemType: row.text("Type d'objet"),
      name: row.text('Nom unique'),
      element: fromLabel(ELEMENTS, row.text('Élément'), where),
      passiveName: row.text('Nom du passif'),
      passiveEffect: row.text('Effet du passif'),
      passiveLimit: row.text('Limite / recharge'),
      biome: fromLabel(BIOMES, row.text('Biome de butin'), where),
      droppedBy: row.text('Lâché par (boss et dragon du biome)'),
      baseLevel: row.int('Niveau de base'),
      maxUpgrade: row.int('Amélioration max'),
    };
  });

  const data: EquipmentData = {
    params: {
      levelCurve: readLevelCurve(params, {
        min: 'Niveau minimum',
        max: 'Niveau maximum',
        base: 'Part de la valeur au niveau 1 (a)',
        exponent: 'Exposant de la courbe (p)',
      }),
      upgradeCost: {
        baseQuantity: params.param('Quantité de ressource pour le niveau 1 (Commun)'),
        exponent: params.param('Exposant de la courbe de coût'),
      },
    },
    rarities,
    stats,
    materialFamilies,
    tiers,
    profiles,
    uniques,
    catalog,
  };

  return {
    data,
    fixtures: {
      equipmentProgression: readProgression(),
      fullSet: readFullSet(),
      upgradeCosts: readUpgradeCosts(),
    },
  };

  /** Onglet Amélioration : ressource pour chaque niveau visé et chaque rareté. */
  function readUpgradeCosts(): FixturesData['upgradeCosts'] {
    const sheet = books.equipment.sheet('Amélioration');
    return sheet.table('Niveau visé (L)').map((row) => {
      const costs = {} as Record<RarityId, number>;
      for (const id of RARITY_IDS) costs[id] = row.int(labelOf(RARITIES, id));
      return { level: row.int('Niveau visé (L)'), costs };
    });
  }

  /** Onglet Progression : l'objet du Calculateur de +0 à son maximum. */
  function readProgression(): FixturesData['equipmentProgression'] {
    const calc = books.equipment.sheet('Calculateur');
    const classId = fromLabel(CLASSES, calc.paramText('Classe'), calc.where);
    const slot = fromLabel(SLOTS, calc.paramText('Slot'), calc.where);
    const rarity = fromLabel(RARITIES, calc.paramText('Rareté'), calc.where);
    const tier = calc.param('Palier (1 = bois … 5 = adamantite)');
    const item = catalog.find(
      (c) =>
        c.classId === classId &&
        c.slot === slot &&
        c.rarity === rarity &&
        (rarity === 'unique' || c.tier === tier),
    );
    if (!item) throw new ImportError(`${calc.where} : objet choisi introuvable dans le Catalogue.`);

    const sheet = books.equipment.sheet('Progression');
    const rows = sheet
      .table('Amélioration')
      // Au-delà de l'amélioration max, les lignes du classeur sont vides.
      .rows.filter((row) => typeof row.raw('Niveau effectif') === 'number')
      .map((row) => ({
        upgrade: row.int('Amélioration'),
        effectiveLevel: row.int('Niveau effectif'),
        factor: row.num('Facteur'),
        stats: readStats(row),
        cost: row.optInt('Coût de ce niveau'),
        cumulativeCost: row.int('Coût cumulé'),
      }));
    return { itemId: item.id, rows };
  }

  /** Onglet Set complet : somme des 10 slots par rareté. */
  function readFullSet(): FixturesData['fullSet'] {
    const sheet = books.equipment.sheet('Set complet');
    const totals = {} as Record<RarityId, StatBlock>;
    for (const row of sheet.table('Rareté', { count: RARITY_IDS.length }).rows) {
      totals[fromLabel(RARITIES, row.text('Rareté'), sheet.where)] = readStats(row);
    }
    return {
      classId: fromLabel(CLASSES, sheet.paramText('Classe'), sheet.where),
      tier: sheet.param('Palier (1 à 5)'),
      upgrade: sheet.param("Niveau d'amélioration"),
      totals,
    };
  }
}
