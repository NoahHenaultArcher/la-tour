/**
 * Schémas Zod des JSON générés par scripts/import-data.ts.
 * Ils servent deux fois : à l'import (le script échoue si une donnée est incohérente)
 * et au chargement (shared/src/data/index.ts).
 */
import { z } from 'zod';
import {
  ATTACK_STAT_IDS,
  ATTACK_TYPE_IDS,
  BIOME_IDS,
  CLASS_IDS,
  DERIVED_STAT_IDS,
  ELEMENT_IDS,
  FLOOR_TYPE_IDS,
  MONSTER_RANK_IDS,
  MONSTER_ROLE_IDS,
  RARITY_IDS,
  SKILL_FAMILY_IDS,
  SKILL_KIND_IDS,
  SKILL_TARGET_IDS,
  SLOT_IDS,
  STAT_IDS,
  UPGRADE_TOWER_BRANCH_IDS,
  ZONE_TYPE_IDS,
} from '../constants.ts';

const text = z.string().min(1);
const nonNegInt = z.int().min(0);
const positiveInt = z.int().min(1);
const nonNeg = z.number().min(0);
const probability = z.number().min(0).max(1);
const imagePath = z.string().min(1).nullable();

export const classIdSchema = z.enum(CLASS_IDS);
export const slotIdSchema = z.enum(SLOT_IDS);
export const statIdSchema = z.enum(STAT_IDS);
export const rarityIdSchema = z.enum(RARITY_IDS);
export const elementIdSchema = z.enum(ELEMENT_IDS);
export const biomeIdSchema = z.enum(BIOME_IDS);
export const rankIdSchema = z.enum(MONSTER_RANK_IDS);
export const roleIdSchema = z.enum(MONSTER_ROLE_IDS);

export const statBlockSchema = z.record(statIdSchema, z.number());
const perClass = <T extends z.ZodType>(value: T) => z.record(classIdSchema, value);

export const levelCurveSchema = z.strictObject({
  minLevel: positiveInt,
  maxLevel: positiveInt,
  /** Part de la valeur au niveau minimum (a). */
  base: probability,
  /** Exposant de la courbe (p). */
  exponent: z.number().positive(),
});

// ---------------------------------------------------------------------------
// Statistiques (Resume_statistiques_RPG.xlsx + bestiaire Paramètres §2 et §9)
// ---------------------------------------------------------------------------

export const statsDataSchema = z.strictObject({
  stats: z.array(
    z.strictObject({
      id: z.union([statIdSchema, z.enum(DERIVED_STAT_IDS)]),
      name: text,
      category: text,
      improvement: text,
      role: text,
      priorities: perClass(text),
      notes: text,
    }),
  ),
  designRules: z.array(z.strictObject({ subject: text, recommendation: text })),
  character: z.strictObject({
    levelCurve: levelCurveSchema,
    hpPerVitality: z.number().positive(),
    baseInitiativeAtMaxLevel: perClass(nonNeg),
  }),
});
export type StatsData = z.infer<typeof statsDataSchema>;

// ---------------------------------------------------------------------------
// Éléments et biomes
// ---------------------------------------------------------------------------

export const elementsDataSchema = z.strictObject({
  elements: z.array(
    z.strictObject({
      id: elementIdSchema,
      name: text,
      icon: z.string(),
      role: text,
      baseEffect: text,
      identity: text,
      biome: biomeIdSchema,
      /** Étage à terminer pour débloquer les variantes de compétences (0 = dès le départ). */
      unlockFloor: nonNegInt,
      skillVariantSuffix: z.string().nullable(),
      skillAlteration: z.string().nullable(),
      attackEffect: text,
      supportEffect: text,
      affinityPassive: text,
      weakAgainst: z.array(elementIdSchema),
      resists: z.array(elementIdSchema),
      inflictedAlterations: z.array(text),
      image: imagePath,
    }),
  ),
  biomes: z.array(
    z.strictObject({
      id: biomeIdSchema,
      name: text,
      element: elementIdSchema,
      floorMin: positiveInt,
      floorMax: positiveInt,
    }),
  ),
  /** Multiplicateur de dégâts : matrix[défenseur][attaquant]. */
  matrix: z.record(elementIdSchema, z.record(elementIdSchema, z.number().positive())),
  fusions: z.array(
    z.strictObject({
      element1: elementIdSchema,
      element2: elementIdSchema,
      name: text,
      proposedEffect: text,
      role: text,
      advantageNote: text,
      status: text,
      image: imagePath,
    }),
  ),
  rules: z.array(z.strictObject({ subject: text, rule: text, reason: text })),
});
export type ElementsData = z.infer<typeof elementsDataSchema>;

// ---------------------------------------------------------------------------
// Ressources
// ---------------------------------------------------------------------------

export const resourcesDataSchema = z.strictObject({
  resources: z.array(
    z.strictObject({
      id: text,
      name: text,
      tier: z.int().min(1).max(5),
      /** Bâtiment qui la produit, ou « taverne » pour les ressources vendues seulement au marchand. */
      source: text,
      unlockFloor: nonNegInt,
      image: imagePath,
    }),
  ),
});
export type ResourcesData = z.infer<typeof resourcesDataSchema>;

// ---------------------------------------------------------------------------
// Équipements
// ---------------------------------------------------------------------------

export const equipmentDataSchema = z.strictObject({
  params: z.strictObject({
    levelCurve: levelCurveSchema,
    upgradeCost: z.strictObject({ baseQuantity: z.number().positive(), exponent: z.number() }),
  }),
  rarities: z.array(
    z.strictObject({
      id: rarityIdSchema,
      name: text,
      order: positiveInt,
      statMultiplier: z.number().positive(),
      statLines: positiveInt,
      hasPassive: z.boolean(),
      naming: text,
      dropInfo: text,
      upgradeCostMultiplier: z.number().positive(),
      color: text,
      frameImage: imagePath,
    }),
  ),
  stats: z.array(
    z.strictObject({
      id: statIdSchema,
      name: text,
      category: text,
      unit: z.enum(['points', 'percent']),
      referenceValue: z.number().positive(),
      decimals: nonNegInt,
      recommendedCap: z.number().positive().nullable(),
      notes: text,
    }),
  ),
  materialFamilies: z.array(
    z.strictObject({
      id: text,
      name: text,
      /** Ressource de chaque palier (1 à 5). */
      tiers: z.array(text).length(5),
      usedFor: text,
    }),
  ),
  tiers: z.array(
    z.strictObject({
      tier: z.int().min(1).max(5),
      baseLevel: positiveInt,
      maxUpgrade: positiveInt,
      maxEffectiveLevel: positiveInt,
      unlockFloor: positiveInt,
    }),
  ),
  profiles: z.array(
    z.strictObject({
      classId: classIdSchema,
      slot: slotIdSchema,
      itemType: text,
      materialFamily: text,
      weights: statBlockSchema,
      /** Rang de chaque stat dans l'objet (1 = dominante, 0 = absente), calculé par le classeur. */
      ranks: statBlockSchema,
    }),
  ),
  uniques: z.array(
    z.strictObject({
      id: text,
      classId: classIdSchema,
      slot: slotIdSchema,
      itemType: text,
      name: text,
      element: elementIdSchema,
      passiveName: text,
      passiveEffect: text,
      passiveLimit: text,
      biome: biomeIdSchema,
      droppedBy: text,
      baseLevel: positiveInt,
      maxUpgrade: positiveInt,
    }),
  ),
  catalog: z.array(
    z.strictObject({
      id: text,
      classId: classIdSchema,
      slot: slotIdSchema,
      rarity: rarityIdSchema,
      /** Palier 1 à 5 ; null pour un Unique (pas de matériau). */
      tier: z.int().min(1).max(5).nullable(),
      material: z.string().nullable(),
      name: text,
      baseLevel: positiveInt,
      maxUpgrade: positiveInt,
      element: elementIdSchema.nullable(),
      /** Valeurs du classeur à +0 (servent de référence aux tests). */
      statsAtZero: statBlockSchema,
      powerAtZero: nonNeg,
      upgradeResourceAtZero: text,
      upgradeCostToOne: positiveInt,
      image: imagePath,
    }),
  ),
});
export type EquipmentData = z.infer<typeof equipmentDataSchema>;

// ---------------------------------------------------------------------------
// Compétences
// ---------------------------------------------------------------------------

const skillCommon = {
  classId: classIdSchema.nullable(),
  family: z.enum(SKILL_FAMILY_IDS),
  kind: z.enum(SKILL_KIND_IDS),
  target: z.enum(SKILL_TARGET_IDS),
  /** Recharge en manches ; null pour un passif. */
  cooldown: z.int().min(0).max(3).nullable(),
  ultimate: z.boolean(),
  power: nonNeg,
  attackStat: z.enum(ATTACK_STAT_IDS).nullable(),
  baseEffect: text,
  trigger: text,
  requiredLevel: positiveInt,
};

export const skillsDataSchema = z.strictObject({
  params: z.strictObject({
    activeSlots: positiveInt,
    passiveSlots: positiveInt,
    maxUltimates: positiveInt,
    enemiesPerWave: positiveInt,
    targetPowerPerTurn: z.number().positive(),
    fusionPowerBonus: z.number().positive(),
    alchemyTowerFloor: nonNegInt,
    simulatedTurns: positiveInt,
    areaScoreWeight: z.number().positive(),
    cooldown1MaxScore: z.number().positive(),
    cooldown2MaxScore: z.number().positive(),
    soloActionsPerRound: positiveInt,
    multiActionsPerRound: positiveInt,
    usesPerRound: positiveInt,
    noCooldownLevel: positiveInt,
  }),
  bases: z.array(
    z.strictObject({
      id: text,
      name: text,
      variantRoot: z.string().nullable(),
      ...skillCommon,
      effectValue: nonNeg.nullable(),
      cooldownScore: nonNeg.nullable(),
    }),
  ),
  catalog: z.array(
    z.strictObject({
      id: text,
      baseId: text,
      name: text,
      element: elementIdSchema,
      ...skillCommon,
      elementEffect: z.string().nullable(),
      unlockFloor: nonNegInt,
      powerPerTurn: nonNeg,
      image: imagePath,
    }),
  ),
  fusions: z.array(
    z.strictObject({
      element1: elementIdSchema,
      element2: elementIdSchema,
      name: text,
      combatEffect: text,
      originalIdea: text,
      role: text,
      availableAfterFloor: nonNegInt,
      examples: perClass(text),
    }),
  ),
  unlockProgression: z.array(
    z.strictObject({
      floor: positiveInt,
      biome: biomeIdSchema,
      newUnlock: z.string().nullable(),
      counts: perClass(z.strictObject({ actives: nonNegInt, passives: nonNegInt })),
      affinities: nonNegInt,
      fusions: nonNegInt,
    }),
  ),
  starterKits: z.array(
    z.strictObject({
      classId: classIdSchema,
      active1: text,
      active2: text,
      passive: text,
      firstSupport: text,
    }),
  ),
});
export type SkillsData = z.infer<typeof skillsDataSchema>;

// ---------------------------------------------------------------------------
// Monstres (bestiaire)
// ---------------------------------------------------------------------------

const roleMultipliersSchema = z.strictObject({
  hp: nonNeg,
  attack: nonNeg,
  resistance: nonNeg,
  armor: nonNeg,
  agility: nonNeg,
  accuracy: nonNeg,
  critChance: nonNeg,
  critDamage: nonNeg,
  penetration: nonNeg,
  statusResistance: nonNeg,
  initiative: nonNeg,
});

export const monsterComputedSchema = z.strictObject({
  level: positiveInt,
  hp: nonNegInt,
  strength: nonNegInt,
  magic: nonNegInt,
  resistance: nonNegInt,
  armor: nonNegInt,
  agility: nonNegInt,
  initiative: nonNegInt,
  accuracy: nonNeg,
  critChance: nonNeg,
  critDamage: nonNeg,
  penetration: nonNeg,
  statusResistance: nonNeg,
  physicalReduction: nonNeg,
  magicalReduction: nonNeg,
  elementalShare: probability,
  damagePerHit: nonNeg,
  turnsToKill: nonNeg,
  rewardMultiplier: nonNeg,
  xp: nonNegInt,
  gold: nonNegInt,
});
export type MonsterComputed = z.infer<typeof monsterComputedSchema>;

export const monstersDataSchema = z.strictObject({
  params: z.strictObject({
    levelCurve: levelCurveSchema,
    referencePlayer: z.strictObject({
      vitality: nonNeg,
      hpPerVitality: nonNeg,
      hp: nonNeg,
      attackStat: nonNeg,
      averageSkillPower: nonNeg,
      averageMonsterReduction: probability,
      damagePerTurn: nonNeg,
    }),
    standardMonster: z.strictObject({
      resistance: nonNeg,
      armor: nonNeg,
      agility: nonNeg,
      accuracy: nonNeg,
      critChance: nonNeg,
      critDamage: nonNeg,
      penetration: nonNeg,
      statusResistanceAtMinLevel: probability,
      statusResistanceAtMaxLevel: probability,
      statusResistanceCap: probability,
      critChanceCap: probability,
      penetrationCap: probability,
      armorReduction: probability,
      resistanceReduction: probability,
      mixedAttackShare: probability,
      initiative: nonNeg,
    }),
    combat: z.strictObject({
      monsterHitRate: probability,
      monsterAveragePower: nonNeg,
      playerAverageReduction: probability,
      tooHardThreshold: probability,
    }),
    floors: z.strictObject({
      monstersPerWave: positiveInt,
      normalWaves: positiveInt,
      bossWaves: positiveInt,
      bossEscorts: nonNegInt,
      huntingLevelSpread: nonNegInt,
    }),
    pace: z.strictObject({
      secondsPerTurn: nonNeg,
      areaTurnSavings: probability,
      deadTimePerWave: nonNeg,
      toleratedLevelGap: nonNegInt,
    }),
    rewards: z.strictObject({
      xpCoefficient: nonNeg,
      xpExponent: nonNeg,
      killsPerLevelBase: nonNeg,
      killsPerLevelGrowth: nonNeg,
      goldCoefficient: nonNeg,
      goldExponent: nonNeg,
      levelGapXpStep: nonNeg,
      levelGapMinFactor: nonNeg,
      levelGapMaxFactor: nonNeg,
      commonPriceInMonsters: nonNeg,
      rarityPriceMultiplier: nonNeg,
    }),
  }),
  roles: z.array(
    z.strictObject({
      id: roleIdSchema,
      name: text,
      multipliers: roleMultipliersSchema,
      elementalShare: probability,
      behavior: text,
    }),
  ),
  ranks: z.array(
    z.strictObject({
      id: rankIdSchema,
      name: text,
      turnsToKill: nonNeg,
      damagePerHit: nonNeg,
      defenseMultiplier: nonNeg,
      rewardMultiplier: nonNeg,
      elementalShareBonus: probability,
      statusResistanceBonus: probability,
      initiativeMultiplier: nonNeg,
      description: text,
    }),
  ),
  alterations: z.array(
    z.strictObject({
      id: text,
      name: text,
      element: elementIdSchema,
      category: text,
      effect: text,
      value: nonNeg,
      unit: text,
      duration: positiveInt,
      maxStacks: positiveInt,
      limit: text,
      onBoss: text,
    }),
  ),
  monsters: z.array(
    z.strictObject({
      id: text,
      name: text,
      diagramName: text,
      zoneFloor: positiveInt,
      rank: rankIdSchema,
      role: roleIdSchema,
      attackType: z.enum(ATTACK_TYPE_IDS),
      alterations: z.array(z.strictObject({ id: text, chance: probability })),
      /** Valeurs du classeur au niveau d'étage de la zone (servent de référence aux tests). */
      atZoneLevel: monsterComputedSchema,
      image: imagePath,
    }),
  ),
});
export type MonstersData = z.infer<typeof monstersDataSchema>;

// ---------------------------------------------------------------------------
// Zones et étages
// ---------------------------------------------------------------------------

const nullableNumber = z.number().nullable();

export const zonesDataSchema = z.strictObject({
  zones: z.array(
    z.strictObject({
      floor: positiveInt,
      name: text,
      type: z.enum(ZONE_TYPE_IDS),
      biome: biomeIdSchema,
      element: elementIdSchema,
      floorsLabel: text,
      hasHuntingZone: z.boolean(),
      huntingLevelMin: positiveInt.nullable(),
      huntingLevelMax: positiveInt.nullable(),
      huntingMonsterCount: nonNegInt,
      bossName: text,
      estimates: z.strictObject({
        averageHuntingLevel: nullableNumber,
        xpPerMonster: nullableNumber,
        goldPerMonster: nullableNumber,
        secondsPerMonster: nullableNumber,
        monstersPerHour: nullableNumber,
        xpPerHour: nullableNumber,
        goldPerHour: nullableNumber,
        dropChance: nullableNumber,
        itemsPerHour: nullableNumber,
        epicOrBetterPerHour: nullableNumber,
        legendaryPerHour: nullableNumber,
        hoursPerUnique: nullableNumber,
      }),
    }),
  ),
});
export type ZonesData = z.infer<typeof zonesDataSchema>;

export const floorsDataSchema = z.strictObject({
  floors: z.array(
    z.strictObject({
      floor: positiveInt,
      monsterLevel: positiveInt,
      biome: biomeIdSchema,
      element: elementIdSchema,
      type: z.enum(FLOOR_TYPE_IDS),
      zoneFloor: positiveInt,
      zoneName: text,
      bossName: z.string().nullable(),
      waves: positiveInt,
      monsterCount: positiveInt,
      unlocksHuntingZone: z.string().nullable(),
      estimates: z.strictObject({
        turns: nonNeg,
        durationSeconds: nonNeg,
        normalWaveDamage: nonNeg,
        bossWaveDamage: nonNeg,
        worstWaveDamage: nonNeg,
        totalDamage: nonNeg,
        difficulty: text,
        xp: nonNegInt,
        gold: nonNegInt,
        expectedItems: nonNeg,
        expectedByRarity: z.record(rarityIdSchema, nonNeg),
      }),
    }),
  ),
});
export type FloorsData = z.infer<typeof floorsDataSchema>;

// ---------------------------------------------------------------------------
// Récompenses (XP, or, prix)
// ---------------------------------------------------------------------------

export const rewardsDataSchema = z.strictObject({
  levels: z.array(
    z.strictObject({
      level: positiveInt,
      levelFactor: nonNeg,
      xpPerNormalMonster: nonNegInt,
      goldPerNormalMonster: nonNegInt,
      /** XP pour passer au niveau suivant ; null au-delà du niveau maximum des héros. */
      xpToNextLevel: nonNegInt.nullable(),
      cumulativeXp: nonNegInt.nullable(),
      itemPrices: z.record(rarityIdSchema.exclude(['unique']), nonNegInt),
    }),
  ),
});
export type RewardsData = z.infer<typeof rewardsDataSchema>;

// ---------------------------------------------------------------------------
// Butin
// ---------------------------------------------------------------------------

const rarityWeightsSchema = z.record(rarityIdSchema, probability);

export const lootDataSchema = z.strictObject({
  dropByRank: z.array(
    z.strictObject({
      rank: rankIdSchema,
      dropChance: probability,
      itemsPerDrop: positiveInt,
      bonusItemChance: probability,
      expectedItems: nonNeg,
      rarityTable: z.enum(['monsters', 'boss', 'dragon']),
      comment: text,
    }),
  ),
  rarityTables: z.record(
    z.enum(['monsters', 'boss', 'dragon']),
    z.array(
      z.strictObject({
        biome: biomeIdSchema,
        element: elementIdSchema,
        weights: rarityWeightsSchema,
      }),
    ),
  ),
  uniquesByBiome: z.array(
    z.strictObject({
      biome: biomeIdSchema,
      element: elementIdSchema,
      uniques: perClass(text),
      droppedBy: text,
    }),
  ),
  rules: z.array(z.strictObject({ topic: text, rule: text })),
});
export type LootData = z.infer<typeof lootDataSchema>;

// ---------------------------------------------------------------------------
// Boutique (taverne)
// ---------------------------------------------------------------------------

export const shopDataSchema = z.strictObject({
  settings: z.strictObject({
    refreshMinutes: positiveInt,
    itemOffers: positiveInt,
    resourceLots: positiveInt,
    unitsPerLot: positiveInt,
    resourcePriceFactor: nonNeg,
    resaleRatio: probability,
  }),
  characters: z.array(
    z.strictObject({
      purchaseNumber: z.int().min(2).max(3),
      referenceFloor: positiveInt,
      huntingHours: nonNeg,
      goldPerHour: nonNeg,
      price: positiveInt,
    }),
  ),
  resources: z.array(
    z.strictObject({
      resourceId: text,
      tier: z.int().min(1).max(5),
      unlockFloor: nonNegInt,
      referenceLevel: positiveInt,
      goldPerMonster: nonNeg,
      unitPrice: positiveInt,
      lotPrice: positiveInt,
      huntingMinutes: nonNeg,
    }),
  ),
  equipment: z.array(
    z.strictObject({
      tier: z.int().min(1).max(5),
      referenceLevel: positiveInt,
      prices: z.record(z.enum(['common', 'rare', 'superRare', 'epic']), positiveInt),
      epicResale: positiveInt,
      epicHuntingMinutes: nonNeg,
    }),
  ),
});
export type ShopData = z.infer<typeof shopDataSchema>;

// ---------------------------------------------------------------------------
// Village
// ---------------------------------------------------------------------------

export const villageDataSchema = z.strictObject({
  buildings: z.array(
    z.strictObject({
      id: text,
      name: text,
      image: imagePath,
      type: text,
      unlockFloor: nonNegInt,
      maxLevel: positiveInt.nullable(),
      goldCostCoefficient: nonNeg.nullable(),
      materialMultiplier: nonNeg.nullable(),
      role: text,
    }),
  ),
  production: z.array(
    z.strictObject({
      buildingId: text,
      resourceId: text,
      tier: z.int().min(1).max(5),
      requiredBuildingLevel: positiveInt,
      requiredFloor: nonNegInt,
      baseProductionPerHour: nonNeg,
      /** Production par heure aux niveaux 1 à 25 du bâtiment (null = pas encore débloquée ou au-delà du max). */
      perLevel: z.array(nonNegInt.nullable()),
      maxLevel: positiveInt,
    }),
  ),
  upgrades: z.array(
    z.strictObject({
      buildingId: text,
      targetLevel: z.int().min(2),
      requiredFloor: nonNegInt,
      /** Vrai quand l'étage requis est fixé à la main dans le classeur au lieu d'être calculé. */
      requiredFloorIsManual: z.boolean(),
      gold: nonNegInt,
      material: text,
      quantity: nonNegInt,
      coal: nonNegInt,
      huntingMinutes: nonNeg,
      effect: text,
    }),
  ),
  params: z.strictObject({
    baseProductionByTier: z.array(nonNeg).length(5),
    productionGrowthPerLevel: nonNeg,
    maxOfflineHours: nonNeg,
    goldCostExponent: nonNeg,
    materialBaseQuantity: nonNeg,
    materialExponent: nonNeg,
    coalShare: nonNeg,
    levelBrackets: z.array(
      z.strictObject({
        minLevel: positiveInt,
        maxLevel: positiveInt,
        material: text,
        requiredFloor: nonNegInt,
      }),
    ),
    warehouse: z.strictObject({ baseCapacity: positiveInt, exponent: nonNeg }),
    tavern: z.strictObject({
      itemOffersAtLevel1: positiveInt,
      resourceLotsAtLevel1: positiveInt,
      discountPerLevel: probability,
    }),
    goldPerHourByZone: z.array(
      z.strictObject({ zoneFloor: positiveInt, goldPerHour: nonNeg, zoneName: text }),
    ),
  }),
  upgradeTower: z.strictObject({
    branches: z.array(
      z.strictObject({
        id: z.enum(UPGRADE_TOWER_BRANCH_IDS),
        name: text,
        bonusPerLevel: nonNeg,
        unit: text,
        maxLevel: positiveInt,
        resourceId: text,
        effect: text,
      }),
    ),
    cost: z.strictObject({
      goldCoefficient: nonNeg,
      goldExponent: nonNeg,
      etherCoefficient: nonNeg,
      branchResourceCoefficient: nonNeg,
      resourceExponent: nonNeg,
    }),
    levels: z.array(
      z.strictObject({
        level: positiveInt,
        gold: nonNegInt,
        ether: nonNegInt,
        branchResource: nonNegInt,
        huntingMinutes: nonNeg,
      }),
    ),
  }),
});
export type VillageData = z.infer<typeof villageDataSchema>;

// ---------------------------------------------------------------------------
// Cas de test tirés des onglets « calculateur » (non utilisés par le jeu)
// ---------------------------------------------------------------------------

export const fixturesDataSchema = z.strictObject({
  equipmentProgression: z.strictObject({
    itemId: text,
    rows: z.array(
      z.strictObject({
        upgrade: nonNegInt,
        effectiveLevel: positiveInt,
        factor: nonNeg,
        stats: statBlockSchema,
        cost: positiveInt.nullable(),
        cumulativeCost: nonNegInt,
      }),
    ),
  }),
  upgradeCosts: z.array(
    z.strictObject({ level: positiveInt, costs: z.record(rarityIdSchema, positiveInt) }),
  ),
  fullSet: z.strictObject({
    classId: classIdSchema,
    tier: z.int().min(1).max(5),
    upgrade: nonNegInt,
    totals: z.record(rarityIdSchema, statBlockSchema),
  }),
  monsterCalculator: z.strictObject({
    monsterId: text,
    levels: z.array(
      monsterComputedSchema.omit({
        elementalShare: true,
        turnsToKill: true,
        rewardMultiplier: true,
      }),
    ),
  }),
});
export type FixturesData = z.infer<typeof fixturesDataSchema>;
