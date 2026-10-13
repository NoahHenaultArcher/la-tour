import { MONSTER_RANK_IDS, MONSTER_ROLE_IDS, RARITY_IDS, type RarityId } from '@la-tour/shared';
import type {
  FixturesData,
  FloorsData,
  LootData,
  MonstersData,
  RewardsData,
  ShopData,
  ZonesData,
} from '@la-tour/shared/schemas';
import { readLevelCurve, type ImportContext } from '../context.ts';
import {
  ATTACK_TYPES,
  BIOMES,
  ELEMENTS,
  FLOOR_TYPES,
  RANKS,
  RARITIES,
  ROLES,
  ZONE_TYPES,
  fromLabel,
  labelOf,
  slugify,
} from '../labels.ts';
import { ImportError, type Row } from '../workbook.ts';

export function importBestiary(context: ImportContext): {
  monsters: MonstersData;
  zones: ZonesData;
  floors: FloorsData;
  rewards: RewardsData;
  loot: LootData;
  shop: ShopData;
  fixtures: Pick<FixturesData, 'monsterCalculator'>;
} {
  const monsters = importMonsters(context);
  return {
    monsters,
    zones: importZones(context),
    floors: importFloors(context),
    rewards: importRewards(context),
    loot: importLoot(context),
    shop: importShop(context),
    fixtures: { monsterCalculator: importMonsterCalculator(context, monsters) },
  };
}

function importMonsters({ books, images }: ImportContext): MonstersData {
  const params = books.bestiary.sheet('Paramètres');

  const alterationsSheet = books.bestiary.sheet('Altérations');
  const alterations = alterationsSheet.table('Altération').map((row) => ({
    id: slugify(row.text('Altération')),
    name: row.text('Altération'),
    element: fromLabel(ELEMENTS, row.text('Élément'), alterationsSheet.where),
    category: row.text('Catégorie'),
    effect: row.text('Effet sur le joueur'),
    value: row.num('Valeur'),
    unit: row.text('Unité'),
    duration: row.int('Durée (tours)'),
    maxStacks: row.int('Cumul max'),
    limit: row.text('Limite / immunité'),
    onBoss: row.text('Sur les boss'),
  }));
  const alterationIds = new Set(alterations.map((a) => a.id));

  const rolesSheet = books.bestiary.sheet('Rôles');
  const roles = rolesSheet.table('Rôle', { count: MONSTER_ROLE_IDS.length }).map((row) => ({
    id: fromLabel(ROLES, row.text('Rôle'), rolesSheet.where),
    name: row.text('Rôle'),
    multipliers: {
      hp: row.num('PV ×'),
      attack: row.num('Attaque ×'),
      resistance: row.num('Résistance ×'),
      armor: row.num('Armure ×'),
      agility: row.num('Agilité ×'),
      accuracy: row.num('Précision ×'),
      critChance: row.num('Critique ×'),
      critDamage: row.num('Dégâts crit. ×'),
      penetration: row.num('Pénétration ×'),
      statusResistance: row.num('Rés. altérations ×'),
      initiative: row.num('Initiative ×'),
    },
    elementalShare: row.num('Part des dégâts élémentaires'),
    behavior: row.text('Comportement'),
  }));
  const ranks = rolesSheet.table('Rang', { count: MONSTER_RANK_IDS.length }).map((row) => ({
    id: fromLabel(RANKS, row.text('Rang'), rolesSheet.where),
    name: row.text('Rang'),
    turnsToKill: row.num('Tours pour tuer'),
    damagePerHit: row.num('Dégâts par coup (% PV joueur)'),
    defenseMultiplier: row.num('Défenses ×'),
    rewardMultiplier: row.num('Récompenses ×'),
    elementalShareBonus: row.num('Bonus part élémentaire'),
    statusResistanceBonus: row.num('Bonus rés. altérations'),
    initiativeMultiplier: row.num('Initiative ×'),
    description: row.text('Description'),
  }));

  const sheet = books.bestiary.sheet('Monstres');
  const forcedLevel = sheet.valueAt('F3');
  if (forcedLevel !== null && forcedLevel !== '') {
    throw new ImportError(
      `${sheet.where} : la cellule F3 (niveau forcé) doit être vide pour importer les stats au niveau de la zone, trouvé « ${String(forcedLevel)} ».`,
    );
  }
  const list = sheet.table('ID').map((row) => {
    const where = `${sheet.where} ligne ${row.index}`;
    const id = row.text('ID');
    const rank = fromLabel(RANKS, row.text('Rang'), where);
    const isBoss = row.yesNo('Boss ?');
    if (isBoss !== (rank === 'boss' || rank === 'dragon')) {
      throw new ImportError(
        `${where} : « Boss ? » incohérent avec le rang « ${row.text('Rang')} ».`,
      );
    }
    const monsterAlterations = [1, 2].flatMap((n) => {
      const name = row.optText(`Altération ${n}`);
      if (name === null) return [];
      const alterationId = slugify(name);
      if (!alterationIds.has(alterationId)) {
        throw new ImportError(`${where} : altération « ${name} » absente de l'onglet Altérations.`);
      }
      return [{ id: alterationId, chance: row.num(`Chance ${n}`) }];
    });
    return {
      id,
      name: row.text('Monstre'),
      diagramName: row.text('Nom dans le diagramme'),
      zoneFloor: row.int('Étage de la zone'),
      rank,
      role: fromLabel(ROLES, row.text('Rôle'), where),
      attackType: fromLabel(ATTACK_TYPES, row.text("Type d'attaque"), where),
      alterations: monsterAlterations,
      atZoneLevel: {
        level: row.int('Niveau'),
        hp: row.int('PV'),
        strength: row.int('Force'),
        magic: row.int('Magie'),
        resistance: row.int('Résistance'),
        armor: row.int('Armure'),
        agility: row.int('Agilité'),
        initiative: row.int('Initiative'),
        accuracy: row.num('Précision'),
        critChance: row.num('Chance de critique'),
        critDamage: row.num('Dégâts critiques'),
        penetration: row.num('Pénétration'),
        statusResistance: row.num('Rés. aux altérations'),
        physicalReduction: row.num('Réduction physique (estim.)'),
        magicalReduction: row.num('Réduction magique (estim.)'),
        elementalShare: row.num('Part de dégâts élémentaires'),
        damagePerHit: row.num('Dégâts par coup (% PV joueur)'),
        turnsToKill: row.num('Tours pour le tuer'),
        rewardMultiplier: row.num('Récompenses ×'),
        xp: row.int('XP'),
        gold: row.int('Or'),
      },
      image: images.get('monstre', id),
    };
  });

  return {
    params: {
      levelCurve: readLevelCurve(params, {
        min: 'Niveau minimum',
        max: 'Niveau maximum de référence',
        base: 'Part de la valeur au niveau 1 (a)',
        exponent: 'Exposant de la courbe (p)',
      }),
      referencePlayer: {
        vitality: params.param('Vitalité du joueur'),
        hpPerVitality: params.param('PV par point de Vitalité'),
        hp: params.param('PV du joueur'),
        attackStat: params.param('Stat offensive du joueur (Force ou Magie)'),
        averageSkillPower: params.param("Puissance moyenne d'une attaque du joueur"),
        averageMonsterReduction: params.param('Réduction moyenne subie par le joueur côté monstre'),
        damagePerTurn: params.param('Dégâts moyens du joueur par tour'),
      },
      standardMonster: {
        resistance: params.param('Résistance'),
        armor: params.param('Armure'),
        agility: params.param('Agilité'),
        accuracy: params.param('Précision de base'),
        critChance: params.param('Chance de critique de base'),
        critDamage: params.param('Bonus de dégâts critiques de base'),
        penetration: params.param('Pénétration de base'),
        statusResistanceAtMinLevel: params.param('Résistance aux altérations au niveau 1'),
        statusResistanceAtMaxLevel: params.param('Résistance aux altérations au niveau 100'),
        statusResistanceCap: params.param('Plafond de résistance aux altérations'),
        critChanceCap: params.param('Plafond de chance de critique'),
        penetrationCap: params.param('Plafond de pénétration'),
        armorReduction: params.param("Réduction physique de l'Armure étalon"),
        resistanceReduction: params.param('Réduction de la Résistance étalon'),
        mixedAttackShare: params.param("Part de l'attaque par stat pour une attaque Mixte"),
        initiative: params.param(
          "Initiative étalon d'un monstre (niveau 100, rang Normal, rôle ×1)",
        ),
      },
      combat: {
        monsterHitRate: params.param('Taux de touche moyen des monstres'),
        monsterAveragePower: params.param("Puissance moyenne d'une attaque de monstre"),
        playerAverageReduction: params.param('Réduction moyenne des dégâts côté joueur'),
        tooHardThreshold: params.param("Seuil d'alerte : PV perdus sur la pire vague"),
      },
      floors: {
        monstersPerWave: params.param('Monstres par vague'),
        normalWaves: params.param("Vagues d'un étage normal"),
        bossWaves: params.param("Vagues d'un étage boss"),
        bossEscorts: params.param('Escortes dans la vague du boss'),
        huntingLevelSpread: params.param('Écart de niveau maximum en zone de chasse'),
      },
      pace: {
        secondsPerTurn: params.param('Secondes par tour de combat'),
        areaTurnSavings: params.param('Tours économisés grâce aux attaques de zone'),
        deadTimePerWave: params.param('Temps mort par vague (s)'),
        toleratedLevelGap: params.param('Écart de niveau toléré (niveau joueur ≥ étage − X)'),
      },
      rewards: {
        xpCoefficient: params.param("XP d'un monstre Normal : coefficient"),
        xpExponent: params.param("XP d'un monstre Normal : exposant"),
        killsPerLevelBase: params.param('Monstres à tuer pour monter de niveau (niveau 1)'),
        killsPerLevelGrowth: params.param('Monstres supplémentaires par niveau (k1)'),
        goldCoefficient: params.param("Or d'un monstre Normal : coefficient"),
        goldExponent: params.param("Or d'un monstre Normal : exposant"),
        levelGapXpStep: params.param("Écart de niveau : variation d'XP par niveau"),
        levelGapMinFactor: params.param('Écart de niveau : facteur minimum'),
        levelGapMaxFactor: params.param('Écart de niveau : facteur maximum'),
        commonPriceInMonsters: params.param("Prix d'un objet Commun (en monstres du même niveau)"),
        rarityPriceMultiplier: params.param('Multiplicateur de prix par rareté'),
      },
    },
    roles,
    ranks,
    alterations,
    monsters: list,
  };
}

function importZones({ books }: ImportContext): ZonesData {
  const sheet = books.bestiary.sheet('Zones');
  const zones = sheet.table('Étage').map((row) => {
    const where = `${sheet.where} ligne ${row.index}`;
    return {
      floor: row.int('Étage'),
      name: row.text('Zone'),
      type: fromLabel(ZONE_TYPES, row.text('Type'), where),
      biome: fromLabel(BIOMES, row.text('Biome'), where),
      element: fromLabel(ELEMENTS, row.text('Élément'), where),
      floorsLabel: row.text('Étages de la tour concernés'),
      hasHuntingZone: row.yesNo('Zone de chasse ?'),
      huntingLevelMin: row.optInt('Niveau min. chasse'),
      huntingLevelMax: row.optInt('Niveau max. chasse'),
      huntingMonsterCount: row.int('Monstres de chasse'),
      bossName: row.text('Boss / dragon'),
      estimates: {
        averageHuntingLevel: row.optNum('Niveau moyen de chasse'),
        xpPerMonster: row.optNum('XP / monstre'),
        goldPerMonster: row.optNum('Or / monstre'),
        secondsPerMonster: row.optNum('Secondes / monstre'),
        monstersPerHour: row.optNum('Monstres / heure'),
        xpPerHour: row.optNum('XP / heure'),
        goldPerHour: row.optNum('Or / heure'),
        dropChance: row.optNum('Chance de butin (moy.)'),
        itemsPerHour: row.optNum('Objets / heure de chasse'),
        epicOrBetterPerHour: row.optNum('Épiques ou mieux / h'),
        legendaryPerHour: row.optNum('Légendaires / h'),
        hoursPerUnique: row.optNum('Heures de chasse pour 1 Unique'),
      },
    };
  });
  return { zones };
}

function rarityValues(row: Row, labelSuffix = ''): Record<RarityId, number> {
  const values = {} as Record<RarityId, number>;
  for (const id of RARITY_IDS) values[id] = row.num(`${labelOf(RARITIES, id)}${labelSuffix}`);
  return values;
}

function importFloors({ books }: ImportContext): FloorsData {
  const sheet = books.bestiary.sheet('Étages');
  const floors = sheet.table('Étage').map((row) => {
    const where = `${sheet.where} ligne ${row.index}`;
    return {
      floor: row.int('Étage'),
      monsterLevel: row.int('Niveau des monstres'),
      biome: fromLabel(BIOMES, row.text('Biome'), where),
      element: fromLabel(ELEMENTS, row.text('Élément'), where),
      type: fromLabel(FLOOR_TYPES, row.text("Type d'étage"), where),
      zoneFloor: row.int('Zone (étage)'),
      zoneName: row.text('Zone'),
      bossName: row.optText('Boss / dragon'),
      waves: row.int('Vagues'),
      monsterCount: row.int('Monstres'),
      unlocksHuntingZone: row.optText('Zone de chasse débloquée'),
      estimates: {
        turns: row.num('Tours estimés'),
        durationSeconds: row.num('Durée (s)'),
        normalWaveDamage: row.num('Dégâts vague normale (% PV)'),
        bossWaveDamage: row.num('Dégâts vague boss/dragon (% PV)'),
        worstWaveDamage: row.num('Pire vague (% PV)'),
        totalDamage: row.num('Total étage (% PV)'),
        difficulty: row.text('Difficulté'),
        xp: row.int("XP de l'étage"),
        gold: row.int("Or de l'étage"),
        expectedItems: row.num('Objets attendus'),
        expectedByRarity: rarityValues(row),
      },
    };
  });
  return { floors };
}

function importRewards({ books }: ImportContext): RewardsData {
  const sheet = books.bestiary.sheet('Récompenses');
  const levels = sheet.table('Niveau').map((row) => ({
    level: row.int('Niveau'),
    levelFactor: row.num('Facteur de niveau'),
    xpPerNormalMonster: row.int('XP / monstre Normal'),
    goldPerNormalMonster: row.int('Or / monstre Normal'),
    xpToNextLevel: row.optInt('XP pour passer au niveau suivant'),
    cumulativeXp: row.optInt('XP cumulée pour atteindre ce niveau'),
    itemPrices: {
      common: row.int('Prix Commun'),
      rare: row.int('Prix Rare'),
      superRare: row.int('Prix Super rare'),
      epic: row.int('Prix Épique'),
      mythic: row.int('Prix Mythique'),
      legendary: row.int('Prix Légendaire'),
    },
  }));
  return { levels };
}

const RARITY_TABLES = { Monstres: 'monsters', Boss: 'boss', Dragon: 'dragon' } as const;

function importLoot({ books }: ImportContext): LootData {
  const sheet = books.bestiary.sheet('Butin');

  const dropByRank = sheet.table('Rang', { count: MONSTER_RANK_IDS.length }).map((row) => {
    const where = `${sheet.where} ligne ${row.index}`;
    return {
      rank: fromLabel(RANKS, row.text('Rang'), where),
      dropChance: row.num('Chance de butin'),
      itemsPerDrop: row.int('Objets par butin'),
      bonusItemChance: row.num("Chance d'un objet bonus"),
      expectedItems: row.num('Objets attendus par victoire'),
      rarityTable: fromLabel(RARITY_TABLES, row.text('Table de rareté utilisée'), where),
      comment: row.text('Commentaire'),
    };
  });

  const readRarityTable = (occurrence: number) =>
    sheet.table('N°', { occurrence, count: 10 }).map((row) => {
      const where = `${sheet.where} ligne ${row.index}`;
      const weights = rarityValues(row);
      const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
      if (Math.abs(total - 1) > 1e-9) {
        throw new ImportError(
          `${where} : les probabilités de rareté font ${total}, au lieu de 100 %.`,
        );
      }
      return {
        biome: fromLabel(BIOMES, row.text('Biome'), where),
        element: fromLabel(ELEMENTS, row.text('Élément'), where),
        weights,
      };
    });

  const uniquesByBiome = sheet.table('N°', { occurrence: 4, count: 10 }).map((row) => {
    const where = `${sheet.where} ligne ${row.index}`;
    const name = (header: string) => row.text(header).replace(/\s*\*$/, '');
    return {
      biome: fromLabel(BIOMES, row.text('Biome'), where),
      element: fromLabel(ELEMENTS, row.text('Élément'), where),
      uniques: { warrior: name('Guerrier'), mage: name('Mage'), ranger: name('Tireur') },
      droppedBy: row.text('Lâchés par'),
    };
  });

  const rules: LootData['rules'] = [];
  for (let row = sheet.findRowStartingWith('7. Règles de butin') + 1; row <= sheet.lastRow; row++) {
    const topic = sheet.value(row, 1);
    const rule = sheet.value(row, 2);
    if (topic === null) break;
    rules.push({ topic: String(topic), rule: String(rule ?? '') });
  }

  return {
    dropByRank,
    rarityTables: {
      monsters: readRarityTable(1),
      boss: readRarityTable(2),
      dragon: readRarityTable(3),
    },
    uniquesByBiome,
    rules,
  };
}

function importShop({ books }: ImportContext): ShopData {
  const sheet = books.bestiary.sheet('Boutique');
  const characters = sheet.table('Achat', { count: 2 }).map((row) => {
    const label = row.text('Achat');
    const purchaseNumber = Number.parseInt(label, 10);
    if (purchaseNumber !== 2 && purchaseNumber !== 3) {
      throw new ImportError(`${sheet.where} ligne ${row.index} : achat « ${label} » inattendu.`);
    }
    return {
      purchaseNumber,
      referenceFloor: row.int('Étage repère'),
      huntingHours: row.num('Heures de chasse'),
      goldPerHour: row.num('Or / heure (zone repère)'),
      price: row.int('Prix (or)'),
    };
  });

  // Le tableau est suivi d'une note, sans ligne vide entre les deux.
  const resources = sheet
    .table('Ressource', { until: (row) => row.raw('Palier') === null })
    .map((row) => ({
      resourceId: slugify(row.text('Ressource')),
      tier: row.int('Palier'),
      unlockFloor: row.int('Étage de déblocage'),
      referenceLevel: row.int('Niveau de référence'),
      goldPerMonster: row.num('Or / monstre Normal (niv. réf.)'),
      unitPrice: row.int('Prix unitaire'),
      lotPrice: row.int('Prix du lot'),
      huntingMinutes: row.num('Minutes de chasse pour un lot'),
    }));

  const equipment = sheet.table('Palier', { count: 5 }).map((row) => ({
    tier: row.int('Palier'),
    referenceLevel: row.int('Niveau de référence du prix'),
    prices: {
      common: row.int('Commun'),
      rare: row.int('Rare'),
      superRare: row.int('Super rare'),
      epic: row.int('Épique'),
    },
    epicResale: row.int('Revente Épique'),
    epicHuntingMinutes: row.num('Minutes de chasse (Épique)'),
  }));

  return {
    settings: {
      refreshMinutes: sheet.param('Renouvellement de la boutique (minutes)'),
      itemOffers: sheet.param("Objets d'équipement proposés"),
      resourceLots: sheet.param('Lots de ressources proposés'),
      unitsPerLot: sheet.param('Unités par lot'),
      resourcePriceFactor: sheet.param(
        "Prix d'une ressource (en or d'un monstre Normal du niveau de référence)",
      ),
      resaleRatio: sheet.param("Revente d'un objet au marchand (part du prix d'achat)"),
    },
    characters,
    resources,
    equipment,
  };
}

const CALCULATOR_FIELDS = {
  Niveau: 'level',
  PV: 'hp',
  Force: 'strength',
  Magie: 'magic',
  Résistance: 'resistance',
  Armure: 'armor',
  Agilité: 'agility',
  Initiative: 'initiative',
  Précision: 'accuracy',
  'Chance de critique': 'critChance',
  'Dégâts critiques': 'critDamage',
  Pénétration: 'penetration',
  'Résistance aux altérations': 'statusResistance',
  'Réduction physique (estim.)': 'physicalReduction',
  'Réduction magique (estim.)': 'magicalReduction',
  'Dégâts par coup (% PV joueur)': 'damagePerHit',
  XP: 'xp',
  Or: 'gold',
} as const;

function importMonsterCalculator(
  { books }: ImportContext,
  monsters: MonstersData,
): FixturesData['monsterCalculator'] {
  const sheet = books.bestiary.sheet('Calculateur');
  const name = sheet.paramText('Monstre');
  const monster = monsters.monsters.find((m) => m.name === name);
  if (!monster)
    throw new ImportError(
      `${sheet.where} : monstre « ${name} » introuvable dans l'onglet Monstres.`,
    );

  const columns = ['Niveau choisi', 'Chasse : niveau min', 'Chasse : niveau max'];
  const levels = columns.map(() => ({}) as Record<string, number>);
  for (const row of sheet.table('Statistique', { count: Object.keys(CALCULATOR_FIELDS).length })
    .rows) {
    const field = fromLabel(CALCULATOR_FIELDS, row.text('Statistique'), sheet.where);
    columns.forEach((column, i) => (levels[i]![field] = row.num(column)));
  }
  return {
    monsterId: monster.id,
    levels: levels as FixturesData['monsterCalculator']['levels'],
  };
}
