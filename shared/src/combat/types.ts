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
import type { AlphaTraitId } from '../balance.ts';
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
  /** Esquive ajoutée par les passifs (Pas léger). */
  dodgeBonus: number;
}

export interface ActiveAlteration {
  id: string;
  stacks: number;
  /** Manches restantes. */
  remaining: number;
  /** Dégâts par manche et par pile (altérations de dégâts sur la durée). */
  damagePerStack: number;
  /** Valeur renforcée par une fusion (sinon celle du bestiaire). */
  value?: number;
  /** Piles maximum relevées (Affinité corrosive, fusion Corrosion). */
  maxStacks?: number;
}

export interface CombatSkill {
  skillId: string;
  /** Recharge en manches (0 = sans recharge). */
  cooldown: number;
  /** Manches avant de pouvoir relancer. */
  remaining: number;
  /** Second élément d'une fusion (Tour d'alchimie), sinon null. */
  fusion?: ElementId | null;
}

/** Stats qu'un effet temporaire peut augmenter ou réduire (en %). */
export type ModifierStat = 'strength' | 'magic' | 'resistance' | 'armor' | 'agility' | 'accuracy';

/**
 * Effet temporaire posé par une compétence, une fusion ou un passif (bonus sur un héros,
 * malus sur un monstre). Les altérations du bestiaire restent dans `alterations`.
 */
export interface CombatModifier {
  /** Origine, unique par combattant : base de compétence (GUE-S01), fusion (fusion:fire+water)… */
  key: string;
  /** Compétence du catalogue qui l'a posé (nom affiché), ou null. */
  skillId: string | null;
  kind: 'buff' | 'debuff';
  /** Manches restantes (baisse en fin de manche). */
  remaining: number;
  stacks: number;
  maxStacks: number;
  /** Stats multipliées par (1 + valeur × piles). */
  stats?: Partial<Record<ModifierStat, number>>;
  /** Chance de critique et esquive ajoutées (× piles). */
  critChance?: number;
  dodge?: number;
  /** Dégâts infligés et subis : multipliés par (1 + valeur × piles). */
  damageDealt?: number;
  damageTaken?: number;
  /** Part des dégâts physiques subis renvoyée à l'attaquant. */
  reflect?: number;
  /** Immunité aux contrôles. */
  controlImmune?: boolean;
  /** Part des PV max rendue en fin de manche. */
  regen?: number;
  /** Les ennemis qui frappent ce héros peuvent subir cette altération. */
  thorns?: { alterationId: string; chance: number };
  /** Dégâts subis en fin de manche (valeur fixe, calculée à la pose). */
  dot?: number;
  /** Dégâts subis par ce monstre chaque fois qu'il attaque (valeur fixe). */
  onAttackDamage?: number;
  /** Joue en dernier dans son camp. */
  playsLast?: boolean;
  /** Bonus de dégâts de la prochaine attaque (ou de la prochaine attaque de zone), consommé. */
  nextAttackBonus?: number;
  nextAreaBonus?: number;
  /** Renvoie une part des dégâts du prochain coup reçu, consommé. */
  reflectNextHit?: number;
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
  /** Manches avant la disparition du bouclier (0 : pas de bouclier). */
  shieldRemaining: number;
  alterations: ActiveAlteration[];
  /** Bonus et malus temporaires (compétences, fusions, passifs). */
  modifiers: CombatModifier[];
  /** Compteurs des passifs et fusions (charges de Surcharge, premier tir de la vague…). */
  counters: Record<string, number>;
  /** Tours perdus en plus du prochain (Gel prolongé du Grand Gel). */
  extraSkips: number;
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
  /** Niveau de la Tour d'alchimie du propriétaire (multijoueur : chacun la sienne). */
  alchemyLevel?: number;
  /** Bonus de la Tour d'amélioration : dégâts infligés (+), dégâts subis (−). */
  damageBonus: number;
  defenseBonus: number;
  isBoss: boolean;
  /** Monstre alpha de l'Abysse : son trait (null ou absent sinon). */
  alpha?: AlphaTraitId | null;
  /** Abysse : second élément de la fusion du monstre (avec son propre élément), sinon null. */
  fusion?: ElementId | null;
  /** Mort déjà prise en compte (récompenses, événement). */
  dead: boolean;
  /** XP et or rapportés par un monstre vaincu. */
  reward: { xp: number; gold: number } | null;
}

export interface MonsterSpawn {
  monsterId: string;
  level: number;
  /** Abysse : étage dont le renfort s'applique (PV et attaque). */
  abyssFloor?: number;
  /** Abysse : monstre alpha et son trait. */
  alpha?: AlphaTraitId;
  /** Abysse : second élément de la fusion du monstre. */
  fusion?: ElementId;
}

export interface KilledMonster {
  monsterId: string;
  level: number;
  xp: number;
  gold: number;
  /** Héros présents quand le monstre est tombé (partage de l'XP et de l'or en multijoueur). */
  sharedBy?: number;
  /** Monstre alpha : butin garanti. */
  alpha?: boolean;
}

/** Tour (étage), zone de chasse (vagues sans fin, sans boss) ou Abysse (étages sans fin après la tour). */
export type CombatMode = 'tower' | 'hunt' | 'abyss';

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
  | { type: 'shield'; targetId: string; amount: number }
  | {
      type: 'modifier';
      targetId: string;
      key: string;
      skillId: string | null;
      kind: 'buff' | 'debuff';
    }
  | { type: 'cleanse'; targetId: string; count: number }
  | { type: 'alteration'; targetId: string; alterationId: string; stacks: number }
  | { type: 'alterationEnd'; targetId: string; alterationId: string }
  | { type: 'resisted'; targetId: string; alterationId: string }
  | { type: 'stunned'; targetId: string; alterationId: string }
  | { type: 'death'; targetId: string }
  /** Dragon : entre en furie sous la moitié de ses PV. */
  | { type: 'enrage'; targetId: string }
  /** Dragon : appelle des monstres de sa zone en renfort. */
  | { type: 'summon'; sourceId: string; monsterIds: string[] }
  /** Monstre alpha enragé (trait « Enragé ») sous la moitié de ses PV. */
  | { type: 'alphaRage'; targetId: string }
  /** Ankh d'Anubis : un héros vaincu se relève. */
  | { type: 'revive'; targetId: string; amount: number }
  /** Pierre ancestrale : le Guerrier attire l'attaque. */
  | { type: 'taunt'; targetId: string }
  /** Un monstre de l'Abysse déclenche sa fusion (élément du monstre + `fusion`). */
  | { type: 'fusion'; actorId: string; element: ElementId; fusion: ElementId }
  | { type: 'end'; outcome: 'victory' | 'defeat' | 'retreat' };

export interface CombatState {
  version: 1;
  /** Absent dans les combats enregistrés avant les zones de chasse : « tower ». */
  mode?: CombatMode;
  /** Étage de la tour, étage de la zone pour une chasse, ou étage de l'Abysse. */
  floor: number;
  floorType: FloorTypeId;
  zoneFloor: number;
  /** Actions par manche : pour toute l'équipe en solo, pour chaque héros en multijoueur. */
  actionsPerRound: number;
  /** Multijoueur : actions restantes de chaque héros pendant le tour des héros (null en solo). */
  heroActions?: Record<string, number> | null;
  /** Niveau de la Tour d'alchimie au début du combat (0 : pas construite). */
  alchemyLevel: number;
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
  /** Reliques et œufs équipés (tous les joueurs en multijoueur, doublons compris). */
  relics?: string[];
  /** Ankh d'Anubis : héros que l'on peut encore relever pendant ce combat. */
  revivesLeft?: number;
}

export interface HeroActionInput {
  heroId: string;
  skillId: string;
  /** Cible pour une compétence mono-cible (ignorée pour une attaque de zone ou sur soi). */
  targetId?: string;
}
