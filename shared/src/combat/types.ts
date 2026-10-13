import type {
  AttackTypeId,
  ClassId,
  ElementId,
  FloorTypeId,
  MonsterRankId,
  MonsterRoleId,
} from '../constants.ts';
import type {
  ElementsData,
  MonstersData,
  SkillsData,
  StatsData,
  VillageData,
  ZonesData,
} from '../data/schemas.ts';
import type { Rng } from '../rules/random.ts';

/** Données du jeu dont le moteur a besoin (passées explicitement : le moteur reste pur). */
export interface CombatData {
  stats: StatsData;
  monsters: MonstersData;
  elements: ElementsData;
  skills: SkillsData;
  zones: ZonesData;
  village: VillageData;
}

export type Side = 'hero' | 'monster';

/** Statistiques utilisées en combat (après équipement, passifs et bonus). */
export interface CombatStats {
  maxHp: number;
  strength: number;
  magic: number;
  resistance: number;
  armor: number;
  agility: number;
  initiative: number;
  accuracy: number;
  critChance: number;
  critDamage: number;
  penetration: number;
  elementalResistance: number;
  healingBonus: number;
  statusResistance: number;
  /** Part élémentaire des dégâts (monstres) ; 0 pour les héros (l'élément vient de la compétence). */
  elementalShare: number;
}

export interface ActiveAlteration {
  id: string;
  stacks: number;
  /** Manches restantes. */
  remaining: number;
  /** Dégâts par manche et par pile (altérations de dégâts sur la durée). */
  damagePerStack: number;
}

export interface CombatSkill {
  skillId: string;
  /** Recharge en manches (0 = sans recharge). */
  cooldown: number;
  /** Manches avant de pouvoir relancer. */
  remaining: number;
}

export interface Combatant {
  /** Identifiant unique dans le combat (h0, h1… / w2m0…). */
  id: string;
  side: Side;
  name: string;
  /** Personnage (héros) ou identifiant de monstre du bestiaire. */
  refId: string;
  classId: ClassId | null;
  level: number;
  element: ElementId;
  rank: MonsterRankId | null;
  role: MonsterRoleId | null;
  attackType: AttackTypeId;
  stats: CombatStats;
  hp: number;
  shield: number;
  alterations: ActiveAlteration[];
  /** Le prochain tour est perdu (assommé, gelé, étourdi). */
  skipNextTurn: boolean;
  /** Ce combattant ne peut pas agir pendant la phase en cours. */
  stunnedThisPhase: boolean;
  /** Manches d'immunité aux contrôles restantes. */
  controlImmunity: number;
  /** Terreur : jamais deux tours perdus de suite. */
  lostLastTurn: boolean;
  /** Compétences actives (héros). */
  skills: CombatSkill[];
  /** Passifs (héros), par identifiant de compétence. */
  passives: string[];
  /** Altérations que le monstre peut infliger. */
  inflicts: { id: string; chance: number }[];
  /** Bonus de la Tour d'amélioration : dégâts infligés (+), dégâts subis (−). */
  damageBonus: number;
  defenseBonus: number;
  isBoss: boolean;
  /** Mort déjà prise en compte (récompenses, événement). */
  dead: boolean;
  /** XP et or rapportés par un monstre vaincu. */
  reward: { xp: number; gold: number } | null;
}

export interface MonsterSpawn {
  monsterId: string;
  level: number;
}

export interface KilledMonster {
  monsterId: string;
  level: number;
  xp: number;
  gold: number;
}

/** Tour (étage) ou zone de chasse (vagues sans fin, sans boss). */
export type CombatMode = 'tower' | 'hunt';

/** « retreat » : le joueur quitte une zone de chasse en gardant ses gains. */
export type CombatPhase = 'heroes' | 'victory' | 'defeat' | 'retreat';

export type CombatEvent =
  | { type: 'round'; round: number; first: Side; heroInitiative: number; monsterInitiative: number }
  | { type: 'wave'; wave: number; total: number }
  | { type: 'action'; actorId: string; skillId: string | null; targetIds: string[] }
  | {
      type: 'damage';
      sourceId: string | null;
      targetId: string;
      amount: number;
      critical: boolean;
      elementMultiplier: number;
      cause: 'attack' | 'alteration';
      alterationId?: string;
    }
  | { type: 'miss'; sourceId: string; targetId: string }
  | { type: 'heal'; sourceId: string; targetId: string; amount: number }
  | { type: 'alteration'; targetId: string; alterationId: string; stacks: number }
  | { type: 'alterationEnd'; targetId: string; alterationId: string }
  | { type: 'resisted'; targetId: string; alterationId: string }
  | { type: 'stunned'; targetId: string; alterationId: string }
  | { type: 'death'; targetId: string }
  | { type: 'end'; outcome: 'victory' | 'defeat' | 'retreat' };

export interface CombatState {
  version: 1;
  /** Absent dans les combats enregistrés avant les zones de chasse : « tower ». */
  mode?: CombatMode;
  /** Étage de la tour, ou étage de la zone pour une chasse. */
  floor: number;
  floorType: FloorTypeId;
  zoneFloor: number;
  /** Actions par manche pour toute l'équipe (solo). */
  actionsPerRound: number;
  waves: MonsterSpawn[][];
  waveIndex: number;
  round: number;
  phase: CombatPhase;
  actionsLeft: number;
  /** Les monstres n'ont pas encore joué cette manche (les héros ont commencé). */
  monstersPending: boolean;
  /** Camp qui a commencé la manche (frise d'initiative). */
  firstSide: Side;
  heroInitiative: number;
  monsterInitiative: number;
  heroes: Combatant[];
  monsters: Combatant[];
  killed: KilledMonster[];
  rng: Rng;
  /** Compteur pour les identifiants des monstres. */
  spawned: number;
}

export interface HeroActionInput {
  heroId: string;
  skillId: string;
  /** Cible pour une compétence mono-cible (ignorée pour une attaque de zone ou sur soi). */
  targetId?: string;
}
