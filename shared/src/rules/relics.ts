/**
 * Reliques et œufs de dragon (demande de l'utilisateur, 15/10/2026 ; absents des classeurs).
 * - Une relique par boss, un œuf par dragon (les wyvernes sont des boss : elles donnent une relique).
 * - 5 % de chance à chaque victoire sur le boss ou le dragon (tour et Abysse, jamais en chasse).
 * - Une seule fois par compte : une relique possédée ne retombe plus. Ni revente, ni amélioration.
 * - 6 emplacements pour tout le compte (reliques et œufs mêlés), sans doublon. Les effets valent pour
 *   toute l'équipe ; en multijoueur, ceux de chaque joueur se cumulent (18 au plus).
 * Exemples de l'utilisateur : Épice (Ver des sables), Arbre-Monde (Roi elfique), Pierre ancestrale
 * (Malphite). Les autres reliques sont des propositions de Claude.
 */
import type { ElementId } from '../constants.ts';

export const RELIC_RULES = {
  dropChance: 0.05,
  slots: 6,
  /** Œuf de dragon : dégâts des compétences de son élément, et des fusions qui le contiennent. */
  eggElementDamage: 0.2,
  eggFusionDamage: 0.1,
  /** Provocation cumulée (plusieurs Pierres ancestrales en multijoueur) : plafond. */
  maxTaunt: 0.9,
  /** Ankh d'Anubis : PV rendus au héros relevé. */
  reviveShare: 0.3,
  /** Égide de l'archange : durée du bouclier de début de combat (manches). */
  startShieldRounds: 2,
} as const;

export type RelicStat =
  'vitality' | 'strength' | 'magic' | 'resistance' | 'armor' | 'agility' | 'initiative';

/** Effet d'une relique (toute l'équipe). Pourcentages en fraction : 0,1 = 10 %. */
export interface RelicEffect {
  /** Statistiques multipliées par (1 + valeur). */
  stats?: Partial<Record<RelicStat, number>>;
  critChance?: number;
  critDamage?: number;
  dodge?: number;
  statusResistance?: number;
  healingBonus?: number;
  /** Dégâts infligés en plus, dégâts subis en moins. */
  damageDealt?: number;
  damageTaken?: number;
  /** Part des PV max rendue à chaque fin de manche. */
  regen?: number;
  /** Part des dégâts infligés rendue en PV. */
  lifesteal?: number;
  /** Chance d'infliger les altérations × (1 + valeur). */
  alterationChance?: number;
  /** Or gagné en plus. */
  gold?: number;
  /** Bouclier de début de combat (part des PV max). */
  startShield?: number;
  /** Chance qu'une attaque ennemie mono-cible vise le Guerrier à la place. */
  taunt?: number;
  /** Nombre de héros relevés une fois par combat. */
  revive?: number;
  /** Œuf de dragon : élément renforcé. */
  element?: ElementId;
}

export interface RelicInfo {
  id: string;
  kind: 'relic' | 'egg';
  name: string;
  /** Boss ou dragon qui la lâche (bestiaire). */
  monsterId: string;
  image: string;
  effect: RelicEffect;
}

const relic = (
  n: number,
  monsterId: string,
  name: string,
  file: string,
  effect: RelicEffect,
): RelicInfo => ({
  id: `REL-${String(n).padStart(2, '0')}`,
  kind: 'relic',
  name,
  monsterId,
  image: `reliques/REL-${String(n).padStart(2, '0')}_${file}.png`,
  effect,
});

const egg = (monsterId: string, element: ElementId, name: string, file: string): RelicInfo => ({
  id: `OEUF-${file.toUpperCase()}`,
  kind: 'egg',
  name,
  monsterId,
  image: `reliques/OEUF-${file}.png`,
  effect: { element },
});

/** Les 20 reliques (une par boss, dans l'ordre de la tour) puis les 10 œufs (un par dragon). */
export const RELICS: readonly RelicInfo[] = [
  relic(1, 'MON-004', "Trophée de l'ours enragé", 'trophee_ours_enrage', {
    stats: { strength: 0.1 },
  }),
  relic(2, 'MON-006', 'Trésor du chef gobelin', 'tresor_chef_gobelin', { gold: 0.15 }),
  relic(3, 'MON-011', 'Totem du haut chaman', 'totem_haut_chaman', { regen: 0.03 }),
  relic(4, 'MON-017', 'Os de guerre orc', 'os_de_guerre_orc', { damageDealt: 0.08 }),
  relic(5, 'MON-022', 'Pierre ancestrale', 'pierre_ancestrale', { taunt: 0.3 }),
  relic(6, 'MON-025', "Lampe de l'Ifrit", 'lampe_ifrit', { stats: { magic: 0.1 } }),
  relic(7, 'MON-029', 'Épice', 'epice', { dodge: 0.1 }),
  relic(8, 'MON-034', "Ankh d'Anubis", 'ankh_anubis', { revive: 1 }),
  relic(9, 'MON-038', 'Gelée royale', 'gelee_royale', { statusResistance: 0.15 }),
  relic(10, 'MON-043', 'Cœur putride', 'coeur_putride', { lifesteal: 0.05 }),
  relic(11, 'MON-047', 'Encre du Kraken', 'encre_kraken', { alterationChance: 0.2 }),
  relic(12, 'MON-052', 'Sceptre du roi triton', 'sceptre_roi_triton', {
    stats: { armor: 0.1, resistance: 0.1 },
  }),
  relic(13, 'MON-056', 'Fourrure de yéti', 'fourrure_yeti', { damageTaken: 0.08 }),
  relic(14, 'MON-061', 'Arbre-Monde', 'arbre_monde', { stats: { vitality: 0.1 } }),
  relic(15, 'MON-066', 'Cristal électrique', 'cristal_electrique', { stats: { initiative: 0.15 } }),
  relic(16, 'MON-070', 'Croc de wyverne mutante', 'croc_wyverne_mutante', { critChance: 0.05 }),
  relic(17, 'MON-073', 'Orbe de grâce', 'orbe_de_grace', { healingBonus: 0.15 }),
  relic(18, 'MON-077', "Égide de l'archange", 'egide_archange', { startShield: 0.1 }),
  relic(19, 'MON-081', 'Écaille des ténèbres', 'ecaille_tenebres', { critDamage: 0.15 }),
  relic(20, 'MON-088', 'Couronne du roi démon', 'couronne_roi_demon', {
    stats: { vitality: 0.05, strength: 0.05, magic: 0.05, resistance: 0.05, agility: 0.05 },
  }),
  egg('MON-005', 'neutral', 'Œuf de dragon neutre', 'neutre'),
  egg('MON-016', 'earth', 'Œuf de dragon de terre', 'terre'),
  egg('MON-024', 'fire', 'Œuf de dragon de feu', 'feu'),
  egg('MON-033', 'wind', 'Œuf de dragon de vent', 'vent'),
  egg('MON-042', 'acid', "Œuf de dragon d'acide", 'acide'),
  egg('MON-051', 'water', "Œuf de dragon d'eau", 'eau'),
  egg('MON-060', 'ice', 'Œuf de dragon de glace', 'glace'),
  egg('MON-069', 'lightning', 'Œuf de dragon électrique', 'electricite'),
  egg('MON-076', 'light', 'Œuf de dragon de lumière', 'lumiere'),
  egg('MON-087', 'shadow', "Œuf de dragon d'ombre", 'ombre'),
];

export const RELIC_IDS = RELICS.map((r) => r.id);

export function relicById(id: string): RelicInfo | undefined {
  return RELICS.find((r) => r.id === id);
}

/** Relique (ou œuf) lâchée par ce boss ou ce dragon, s'il en a une. */
export function relicOfMonster(monsterId: string): RelicInfo | undefined {
  return RELICS.find((r) => r.monsterId === monsterId);
}

/** Effets cumulés d'un ensemble de reliques (une équipe, ou tous les joueurs d'un salon). */
export interface RelicBonus {
  stats: Partial<Record<RelicStat, number>>;
  critChance: number;
  critDamage: number;
  dodge: number;
  statusResistance: number;
  healingBonus: number;
  damageDealt: number;
  damageTaken: number;
  regen: number;
  lifesteal: number;
  alterationChance: number;
  gold: number;
  startShield: number;
  taunt: number;
  revive: number;
  /** Œufs : bonus de dégâts par élément (compétences de cet élément). */
  elementDamage: Partial<Record<ElementId, number>>;
  /** Œufs : bonus de dégâts des fusions qui contiennent cet élément. */
  fusionDamage: Partial<Record<ElementId, number>>;
}

export function emptyRelicBonus(): RelicBonus {
  return {
    stats: {},
    critChance: 0,
    critDamage: 0,
    dodge: 0,
    statusResistance: 0,
    healingBonus: 0,
    damageDealt: 0,
    damageTaken: 0,
    regen: 0,
    lifesteal: 0,
    alterationChance: 0,
    gold: 0,
    startShield: 0,
    taunt: 0,
    revive: 0,
    elementDamage: {},
    fusionDamage: {},
  };
}

const ADDITIVE = [
  'critChance',
  'critDamage',
  'dodge',
  'statusResistance',
  'healingBonus',
  'damageDealt',
  'damageTaken',
  'regen',
  'lifesteal',
  'alterationChance',
  'gold',
  'startShield',
  'taunt',
  'revive',
] as const;

/** Somme des effets ; les identifiants inconnus sont ignorés (relique retirée du jeu). */
export function relicBonus(ids: readonly string[]): RelicBonus {
  const bonus = emptyRelicBonus();
  for (const id of ids) {
    const effect = relicById(id)?.effect;
    if (!effect) continue;
    for (const [stat, value] of Object.entries(effect.stats ?? {}) as [RelicStat, number][])
      bonus.stats[stat] = (bonus.stats[stat] ?? 0) + value;
    for (const key of ADDITIVE) bonus[key] += effect[key] ?? 0;
    if (effect.element) {
      const e = effect.element;
      bonus.elementDamage[e] = (bonus.elementDamage[e] ?? 0) + RELIC_RULES.eggElementDamage;
      bonus.fusionDamage[e] = (bonus.fusionDamage[e] ?? 0) + RELIC_RULES.eggFusionDamage;
    }
  }
  bonus.taunt = Math.min(RELIC_RULES.maxTaunt, bonus.taunt);
  return bonus;
}

/**
 * Bonus de dégâts d'une compétence dû aux œufs : son élément (+20 % par œuf), et pour une
 * compétence fusionnée, chaque élément de la fusion (+10 % par œuf).
 */
export function eggDamageBonus(
  bonus: RelicBonus,
  element: ElementId,
  fusion: ElementId | null,
): number {
  let total = bonus.elementDamage[element] ?? 0;
  if (fusion) {
    total += bonus.fusionDamage[element] ?? 0;
    if (fusion !== element) total += bonus.fusionDamage[fusion] ?? 0;
  }
  return total;
}
