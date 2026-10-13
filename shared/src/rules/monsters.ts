/**
 * Monstres : stats et récompenses à un niveau donné.
 * Formules de Bestiaire_Tour_RPG.xlsx (onglets Monstres, Rôles et Paramètres).
 * L'ordre des multiplications suit celui du classeur pour obtenir exactement les mêmes arrondis.
 */
import type { ElementId } from '../constants.ts';
import type { MonsterComputed, MonstersData } from '../data/schemas.ts';
import { excelRound, levelFactor, spreadsheetPrecision } from './math.ts';

export type Monster = MonstersData['monsters'][number];

export function monsterStats(
  data: MonstersData,
  monster: Monster,
  level: number,
  element: ElementId,
): MonsterComputed {
  const { params } = data;
  const std = params.standardMonster;
  const role = data.roles.find((r) => r.id === monster.role);
  const rank = data.ranks.find((r) => r.id === monster.rank);
  if (!role || !rank) throw new Error(`Rôle ou rang inconnu pour ${monster.id}`);
  const m = role.multipliers;
  const curve = params.levelCurve;
  const f = levelFactor(level, curve);

  const attackShare = (wanted: 'physical' | 'magical') =>
    monster.attackType === wanted ? 1 : monster.attackType === 'mixed' ? std.mixedAttackShare : 0;
  const attackStat = (share: number) =>
    excelRound(
      (share * params.referencePlayer.hp * f * rank.damagePerHit * m.attack) /
        (params.combat.monsterAveragePower * (1 - params.combat.playerAverageReduction)),
    );

  const resistance = excelRound(std.resistance * f * m.resistance * rank.defenseMultiplier);
  const armor = excelRound(std.armor * f * m.armor * rank.defenseMultiplier);
  // Constante K telle que le monstre étalon réduise toujours les dégâts du même pourcentage.
  const armorK = (std.armor * f * (1 - std.armorReduction)) / std.armorReduction;
  const resistanceK =
    (std.resistance * f * (1 - std.resistanceReduction)) / std.resistanceReduction;
  const statusProgress = (level - curve.minLevel) / (curve.maxLevel - curve.minLevel);

  return {
    level,
    hp: excelRound(params.referencePlayer.damagePerTurn * f * rank.turnsToKill * m.hp),
    strength: attackStat(attackShare('physical')),
    magic: attackStat(attackShare('magical')),
    resistance,
    armor,
    agility: excelRound(std.agility * f * m.agility),
    initiative: excelRound(std.initiative * f * m.initiative * rank.initiativeMultiplier),
    accuracy: Math.min(1, excelRound(std.accuracy * m.accuracy, 3)),
    critChance: Math.min(std.critChanceCap, excelRound(std.critChance * m.critChance, 3)),
    critDamage: excelRound(std.critDamage * m.critDamage, 3),
    penetration: Math.min(std.penetrationCap, excelRound(std.penetration * m.penetration, 3)),
    statusResistance: Math.min(
      std.statusResistanceCap,
      excelRound(
        (std.statusResistanceAtMinLevel +
          (std.statusResistanceAtMaxLevel - std.statusResistanceAtMinLevel) * statusProgress) *
          m.statusResistance +
          rank.statusResistanceBonus,
        3,
      ),
    ),
    physicalReduction: excelRound(
      1 - (1 - armor / (armor + armorK)) * (1 - resistance / (resistance + resistanceK)),
      3,
    ),
    magicalReduction: excelRound(resistance / (resistance + resistanceK), 3),
    elementalShare:
      element === 'neutral'
        ? 0
        : Math.min(1, spreadsheetPrecision(role.elementalShare + rank.elementalShareBonus)),
    damagePerHit: excelRound(rank.damagePerHit * m.attack, 4),
    turnsToKill: excelRound(rank.turnsToKill * m.hp, 2),
    rewardMultiplier: rank.rewardMultiplier,
    xp: excelRound(normalMonsterXp(data, level) * rank.rewardMultiplier),
    gold: excelRound(normalMonsterGold(data, level) * rank.rewardMultiplier),
  };
}

/** XP d'un monstre Normal : coefficient × niveau ^ exposant, arrondi. */
export function normalMonsterXp(data: MonstersData, level: number): number {
  const r = data.params.rewards;
  return excelRound(r.xpCoefficient * level ** r.xpExponent);
}

/** Or d'un monstre Normal : coefficient × niveau ^ exposant, arrondi. */
export function normalMonsterGold(data: MonstersData, level: number): number {
  const r = data.params.rewards;
  return excelRound(r.goldCoefficient * level ** r.goldExponent);
}

/** Niveaux possibles d'un monstre en zone de chasse : étage de la zone → étage + écart. */
export function huntingLevelRange(
  data: MonstersData,
  zoneFloor: number,
): { min: number; max: number } {
  return { min: zoneFloor, max: zoneFloor + data.params.floors.huntingLevelSpread };
}

/** Chance réelle d'appliquer une altération : chance du monstre × (1 − résistance du héros). */
export function effectiveAlterationChance(chance: number, heroStatusResistance: number): number {
  return chance * (1 - heroStatusResistance);
}
