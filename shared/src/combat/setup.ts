/**
 * Préparation d'un combat : composition des vagues d'un étage et création des combattants.
 */
import {
  EARLY_GAME,
  MONSTER_SCALING,
  earlyGameFactor,
  monsterHpForTeam,
  monsterDifficulty,
} from '../balance.ts';
import type { ClassId, ElementId, StatBlock } from '../constants.ts';
import { classAttackStat, heroStats } from '../rules/heroes.ts';
import { monsterStats } from '../rules/monsters.ts';
import { nextInt, pick, type Rng } from '../rules/random.ts';
import type { StatAllocation } from '../rules/statPoints.ts';
import { floorType, zoneFloorOf } from '../rules/tower.ts';
import { upgradeTowerBonus, type UpgradeTowerLevels } from '../rules/village.ts';
import { passiveEffectsOf, skillById } from './skills.ts';
import type { CombatData, CombatStats, Combatant, MonsterSpawn } from './types.ts';
import { byId } from '../rules/lookup.ts';

/** Positions du deck : 0 à 2 actives, 3 et 4 passives. */
const ACTIVE_POSITIONS = [0, 1, 2];

export interface HeroSetup {
  characterId: string;
  classId: ClassId;
  level: number;
  heritageCount: number;
  /** Stats des objets équipés. */
  equipment: StatBlock[];
  deck: { position: number; skillId: string; fusionElement?: ElementId | null }[];
  /** Points de statistiques répartis. */
  allocation?: StatAllocation;
  /** Multijoueur : Tour d'amélioration et Tour d'alchimie du propriétaire du héros. */
  tower?: UpgradeTowerLevels;
  alchemyLevel?: number;
}

/**
 * Vagues d'un étage : normal = 3 vagues de 3 monstres de la zone ; boss = 4 vagues normales
 * puis le boss + 2 escortes ; dragon = le dragon seul. Les monstres ont le niveau de l'étage.
 */
export function buildFloorWaves(data: CombatData, floor: number, rng: Rng): MonsterSpawn[][] {
  const params = data.monsters.params.floors;
  const zoneFloor = zoneFloorOf(floor);
  const zoneMonsters = data.monsters.monsters.filter((m) => m.zoneFloor === zoneFloor);
  const regulars = zoneMonsters.filter((m) => m.rank !== 'boss' && m.rank !== 'dragon');
  const boss = zoneMonsters.find((m) => m.rank === 'boss' || m.rank === 'dragon');
  const spawn = (monsterId: string): MonsterSpawn => ({ monsterId, level: floor });
  const regularWave = () =>
    Array.from({ length: params.monstersPerWave }, () => spawn(pick(rng, regulars).id));

  const type = floorType(floor);
  if (type === 'dragon') {
    if (!boss) throw new Error(`Pas de dragon pour l'étage ${floor}`);
    return [[spawn(boss.id)]];
  }
  if (type === 'normal') return Array.from({ length: params.normalWaves }, regularWave);
  if (!boss) throw new Error(`Pas de boss pour l'étage ${floor}`);
  const waves = Array.from({ length: params.bossWaves - 1 }, regularWave);
  waves.push([
    spawn(boss.id),
    ...Array.from({ length: params.bossEscorts }, () => spawn(pick(rng, regulars).id)),
  ]);
  return waves;
}

/**
 * Stats de combat d'un héros : base + équipement + héritage, puis passifs du deck
 * et bonus de PV de la Tour d'amélioration. Sert au combat et à la page Équipe.
 */
export function heroCombatStats(
  data: CombatData,
  hero: HeroSetup,
  tower: UpgradeTowerLevels,
): CombatStats {
  const stats = heroStats(data.stats, hero);
  let dodgeBonus = 0;
  const passives = hero.deck
    .filter((s) => !ACTIVE_POSITIONS.includes(s.position))
    .map((s) => s.skillId);
  for (const effect of passiveEffectsOf(data, passives)) {
    for (const [stat, value] of Object.entries(effect.multiply ?? {})) {
      stats[stat as keyof StatBlock] = Math.round(stats[stat as keyof StatBlock] * (1 + value));
    }
    for (const [stat, value] of Object.entries(effect.add ?? {})) {
      if (stat === 'dodgeBonus') dodgeBonus += value;
      else stats[stat as keyof StatBlock] += value;
    }
  }
  return {
    maxHp: Math.round(
      stats.vitality *
        data.stats.character.hpPerVitality *
        (1 + upgradeTowerBonus(data.village, tower, 'hp')),
    ),
    strength: stats.strength,
    magic: stats.magic,
    resistance: stats.resistance,
    armor: stats.armor,
    agility: stats.agility,
    initiative: stats.initiative,
    accuracy: stats.accuracy,
    critChance: stats.critChance,
    critDamage: stats.critDamage,
    penetration: stats.penetration,
    elementalResistance: stats.elementalResistance,
    healingBonus: stats.healingBonus,
    statusResistance: stats.statusResistance,
    elementalShare: 0,
    dodgeBonus,
  };
}

/**
 * Vague d'une zone de chasse : 3 monstres de la zone (jamais le boss), chacun d'un niveau tiré
 * entre l'étage de la zone et l'étage + 10.
 */
export function buildHuntWave(data: CombatData, zoneFloor: number, rng: Rng): MonsterSpawn[] {
  const params = data.monsters.params.floors;
  const regulars = data.monsters.monsters.filter(
    (m) => m.zoneFloor === zoneFloor && m.rank !== 'boss' && m.rank !== 'dragon',
  );
  if (regulars.length === 0) throw new Error(`Pas de zone de chasse à l'étage ${zoneFloor}`);
  return Array.from({ length: params.monstersPerWave }, () => ({
    monsterId: pick(rng, regulars).id,
    level: zoneFloor + nextInt(rng, params.huntingLevelSpread + 1),
  }));
}

export function createHeroCombatant(
  data: CombatData,
  hero: HeroSetup,
  index: number,
  tower: UpgradeTowerLevels,
): Combatant {
  const stats = heroCombatStats(data, hero, tower);
  const passives = hero.deck
    .filter((s) => !ACTIVE_POSITIONS.includes(s.position))
    .map((s) => s.skillId);
  return {
    id: `h${index}`,
    side: 'hero',
    name: hero.classId,
    refId: hero.characterId,
    classId: hero.classId,
    level: hero.level,
    element: 'neutral',
    rank: null,
    role: null,
    attackType: classAttackStat(hero.classId) === 'magic' ? 'magical' : 'physical',
    stats,
    hp: stats.maxHp,
    shield: 0,
    shieldRemaining: 0,
    alterations: [],
    modifiers: [],
    counters: {},
    extraSkips: 0,
    skipNextTurn: false,
    stunnedThisPhase: false,
    controlImmunity: 0,
    lostLastTurn: false,
    skills: hero.deck
      .filter((s) => ACTIVE_POSITIONS.includes(s.position))
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        skillId: s.skillId,
        cooldown: skillById(data, s.skillId).cooldown ?? 0,
        remaining: 0,
        fusion: s.fusionElement ?? null,
      })),
    passives,
    inflicts: [],
    ...(hero.alchemyLevel !== undefined ? { alchemyLevel: hero.alchemyLevel } : {}),
    damageBonus: upgradeTowerBonus(data.village, tower, 'damage'),
    defenseBonus: upgradeTowerBonus(data.village, tower, 'defense'),
    isBoss: false,
    dead: false,
    reward: null,
  };
}

export function createMonsterCombatant(
  data: CombatData,
  spawn: MonsterSpawn,
  id: string,
  /** Nombre de héros du combat : plus l'équipe est grande, plus les monstres ont de PV. */
  heroCount = 1,
): Combatant {
  const monster = byId(data.monsters.monsters, spawn.monsterId);
  if (!monster) throw new Error(`Monstre inconnu : ${spawn.monsterId}`);
  const zone = data.zones.zones.find((z) => z.floor === monster.zoneFloor);
  const element = zone?.element ?? 'neutral';
  const s = monsterStats(data.monsters, monster, spawn.level, element);
  // Début de partie adouci (balance.ts, EARLY_GAME) : PV et attaque réduits sur les premiers niveaux.
  // Difficulté exigeante (MONSTER_SCALING) : PV et attaque montent avec le niveau du monstre.
  const hp = Math.max(
    1,
    Math.round(
      s.hp *
        earlyGameFactor(spawn.level, EARLY_GAME.hpFactorAtLevel1) *
        monsterDifficulty(spawn.level, MONSTER_SCALING.hpAtLevel1, MONSTER_SCALING.hpAtLevel100) *
        monsterHpForTeam(heroCount),
    ),
  );
  const attack =
    earlyGameFactor(spawn.level, EARLY_GAME.attackFactorAtLevel1) *
    monsterDifficulty(
      spawn.level,
      MONSTER_SCALING.attackAtLevel1,
      MONSTER_SCALING.attackAtLevel100,
    );
  return {
    id,
    side: 'monster',
    name: monster.name,
    refId: monster.id,
    classId: null,
    level: spawn.level,
    element,
    rank: monster.rank,
    role: monster.role,
    attackType: monster.attackType,
    stats: {
      maxHp: hp,
      strength: Math.round(s.strength * attack),
      magic: Math.round(s.magic * attack),
      resistance: s.resistance,
      armor: s.armor,
      agility: s.agility,
      initiative: s.initiative,
      accuracy: s.accuracy,
      critChance: s.critChance,
      critDamage: s.critDamage,
      penetration: s.penetration,
      elementalResistance: 0,
      healingBonus: 0,
      statusResistance: s.statusResistance,
      elementalShare: s.elementalShare,
      dodgeBonus: 0,
    },
    hp,
    shield: 0,
    shieldRemaining: 0,
    alterations: [],
    modifiers: [],
    counters: {},
    extraSkips: 0,
    skipNextTurn: false,
    stunnedThisPhase: false,
    controlImmunity: 0,
    lostLastTurn: false,
    skills: [],
    passives: [],
    inflicts: monster.alterations,
    damageBonus: 0,
    defenseBonus: 0,
    isBoss: monster.rank === 'boss' || monster.rank === 'dragon',
    dead: false,
    reward: { xp: s.xp, gold: s.gold },
  };
}
