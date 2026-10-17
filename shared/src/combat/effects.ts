/**
 * Effets mécaniques des compétences. Les classeurs décrivent les effets en texte libre
 * (Competences_RPG_Tour.xlsx : Bases, Éléments, Fusions) : chaque texte est traduit ici en règle.
 * Les chances, durées et valeurs reprennent celles du texte ; quand le texte n'en donne pas,
 * on reprend celles de l'élément (ex. Brûlure 35 %) ou COMBAT_RULES.defaultEffectRounds.
 * Les altérations elles-mêmes (dégâts, cumul, durée) viennent du bestiaire (alterations.ts).
 */
import type { ElementId } from '../constants.ts';
import type { ModifierSpec } from './modifiers.ts';

/** Altération tentée par une attaque. */
export interface AlterationSpec {
  id: string;
  chance: number;
  /** Piles ajoutées d'un coup. */
  stacks?: number;
  /** Tente l'altération sur tous les ennemis vivants (pas seulement les cibles touchées). */
  allEnemies?: boolean;
  /** Valeur renforcée (Brasier : Brûlure à 12 %). */
  value?: number;
  maxStacks?: number;
  /** Durée imposée. */
  duration?: number;
  /** Seulement si la cible porte déjà une de ces altérations. */
  requires?: string[];
  /** Seulement contre une compétence mono-cible (Zéro absolu). */
  singleTargetOnly?: boolean;
  /** Le Gel déclenché dure un tour de plus (Grand Gel, hors boss). */
  longFreeze?: boolean;
}

/** Effets d'une attaque (compétence d'attaque, effet d'élément ou fusion). Tout est additif. */
export interface AttackEffect {
  armorIgnore?: number;
  resistanceIgnore?: number;
  neverMiss?: boolean;
  bonusCrit?: number;
  guaranteedCrit?: boolean;
  /** Bonus de dégâts (+0,15 = +15 %). */
  damageBonus?: number;
  /** Nombre de coups ; la puissance est répartie entre eux (2 × 40 %). */
  hits?: number;
  /** Ennemis supplémentaires touchés à une part des dégâts (rebond, traversée). */
  extraTargets?: { count: number; share: number; requires?: string };
  alterations?: AlterationSpec[];
  /** Les altérations sont appliquées avant les dégâts (Orage : Mouillé puis frappe). */
  preAlterations?: AlterationSpec[];
  /** Chance des altérations × (1 + valeur) (Pluie arcanique : +50 %). */
  alterationChanceBonus?: number;
  /** L'effet élémentaire est garanti sur la cible principale (Météore). */
  guaranteedOnPrimary?: boolean;
  /** Bonus de dégâts si la cible a moins de `below` de ses PV (Exécution). */
  executeBonus?: { below: number; bonus: number };
  /** Bonus de dégâts si la cible porte une altération (Explosion arcanique). */
  bonusVsAltered?: number;
  /** Bonus de dégâts contre un élément (Eau bénite contre l'Ombre). */
  bonusVsElement?: { element: ElementId; bonus: number };
  /** Part des dégâts rendue en PV au lanceur. */
  lifesteal?: number;
  /** Part des dégâts convertie en bouclier pour le lanceur (2 manches). */
  shieldFromDamage?: number;
  /** Soin et bouclier du lanceur (part de ses PV max). */
  selfHeal?: number;
  selfShield?: number;
  /** Altérations retirées au lanceur. */
  cleanseSelf?: number;
  /** Effet temporaire sur le lanceur. */
  selfModifier?: ModifierSpec;
  /** Effet temporaire sur chaque cible touchée (avec condition éventuelle). */
  targetModifier?: ModifierSpec & { requires?: string[] };
  /** Effet temporaire sur tous les ennemis vivants. */
  allEnemiesModifier?: ModifierSpec;
  ignoreElement?: boolean;
  /** Détruit le bouclier de la cible. */
  destroyShield?: boolean;
  /** Retire des effets positifs de la cible. */
  dispel?: number;
  /** À la mort d'une cible qui les porte, ces altérations passent à un autre ennemi. */
  deathSpread?: string[];
  /** L'altération appliquée à la cible l'est aussi à un autre ennemi (si la cible porte `requires`). */
  spread?: { id: string; requires?: string };
  /** Règle trop particulière pour les champs ci-dessus (voir actions.ts). */
  special?:
    | 'brimstone'
    | 'cryopyre'
    | 'surcharge'
    | 'crepuscule'
    | 'equilibre'
    | 'distortion'
    | 'fleau'
    | 'glacier'
    | 'orage';
}

/**
 * Effets d'une compétence de soutien. Soin, bouclier, purification et bonus touchent le lanceur,
 * ou chaque héros vivant si la compétence cible toute l'équipe (Cible « Équipe » de l'onglet Bases).
 */
export interface SupportEffect {
  /** Durée de l'effet (sert aussi à l'effet d'élément du soutien). */
  duration: number;
  /** Soin et bouclier (part des PV max de chaque héros soigné ou protégé). */
  heal?: number;
  shield?: number;
  /** Retire toutes les altérations. */
  cleanse?: boolean;
  /** Bonus temporaire. */
  buff?: ModifierSpec;
  /** Malus sur la cible (soutiens « debuff »). */
  targetModifier?: ModifierSpec;
  /** Partie attaque des soutiens qui frappent (Coup de bouclier, Flèche marquante, Piège à loup). */
  attack?: AttackEffect;
}

/** Effet ajouté par l'élément d'une compétence de soutien (onglet Éléments, « effet soutien »). */
export interface SupportElementEffect {
  /** Bonus sur le lanceur pendant la durée de l'effet. */
  modifier?: Omit<ModifierSpec, 'duration'>;
  /** Soin supplémentaire (part des PV max). */
  extraHeal?: number;
  removeBurn?: boolean;
  /** Soins et boucliers de la compétence × (1 + valeur). */
  healShieldBoost?: number;
}

/** Passifs de classe et affinités élémentaires. */
export interface PassiveEffect {
  /** Stat multipliée par (1 + valeur). */
  multiply?: Partial<Record<'resistance' | 'magic' | 'strength' | 'armor', number>>;
  /** Stat augmentée de la valeur. */
  add?: Partial<
    Record<'critChance' | 'critDamage' | 'penetration' | 'healingBonus' | 'dodgeBonus', number>
  >;
  /** Vol de vie (part des dégâts infligés). */
  lifesteal?: number;
  counterAttack?: { chance: number; power: number };
  /** +x % de dégâts par tranche de 10 % de PV perdus, plafonné. */
  rage?: { perTenth: number; max: number };
  /** Chaque coup réduit la Résistance de la cible (piles). */
  sunder?: { value: number; maxStacks: number };
  /** Bouclier (part des PV max) toutes les N manches. */
  periodicShield?: { share: number; every: number };
  /** Soin en fin de manche (part des PV max). */
  regen?: number;
  /** Chance qu'un sort à recharge 1 frappe une seconde fois. */
  echo?: { chance: number; share: number };
  /** Les altérations infligées durent plus longtemps (toutes, ou une seule). */
  alterationExtraDuration?: { rounds: number; only?: string };
  /** Toutes les N manches, la recharge la plus longue baisse de 1. */
  cooldownReduction?: { every: number };
  bonusVsAltered?: number;
  /** Premier tir de chaque vague critique. */
  firstShotCrit?: boolean;
  /** Les coups critiques appliquent Saignement / rendent une part des dégâts. */
  critBleed?: boolean;
  critHeal?: number;
  /** Tir gratuit sur un ennemi au hasard toutes les N manches. */
  freeShot?: { every: number; power: number };
  /** Bonus de dégâts des compétences d'un élément. */
  elementDamage?: { element: ElementId; bonus: number };
  /** Résistance ignorée en plus par les compétences Neutres. */
  neutralResistanceIgnore?: number;
  corrosionMaxStacks?: number;
  /** Soins reçus × (1 + valeur). */
  healReceived?: number;
  /** Gel à N piles de Froid (3 sur les boss). */
  freezeAt?: number;
  /** Dégâts des rebonds (ennemis supplémentaires) + valeur. */
  bounceBonus?: number;
}

const ROUNDS = 2;

// ---------------------------------------------------------------------------
// Compétences d'attaque (onglet Bases, colonne « Effet »)
// ---------------------------------------------------------------------------

export const ATTACK_EFFECTS: Record<string, AttackEffect> = {
  // Guerrier
  'GUE-A01': {}, // Frappe rapide : coup simple et fiable.
  'GUE-A02': { armorIgnore: 0.2 }, // Coup d'estoc : ignore 20 % de l'Armure.
  'GUE-A03': { alterations: [{ id: 'assomme', chance: 0.15 }] }, // Coup vertical : 15 % Assommé.
  'GUE-A04': {}, // Tourbillon : toute la vague.
  'GUE-A05': { alterations: [{ id: 'saignement', chance: 0.35 }] }, // Entaille : 35 % Saignement.
  'GUE-A06': { alterations: [{ id: 'intimide', chance: 1 }] }, // Charge : Intimide la cible.
  'GUE-A07': { executeBonus: { below: 0.3, bonus: 0.5 } }, // Exécution : +50 % sous 30 % de PV.
  'GUE-A08': { alterations: [{ id: 'assomme', chance: 0.2 }] }, // Onde de choc : 20 % Assommé.
  // Mage
  'MAG-A01': {}, // Boule arcanique.
  'MAG-A02': { resistanceIgnore: 0.15 }, // Lance arcanique : ignore 15 % de la Résistance.
  'MAG-A03': {}, // Tornade arcanique : toute la vague.
  'MAG-A04': { hits: 2 }, // Rayon arcanique : deux impacts (2 × 40 %).
  'MAG-A05': { alterationChanceBonus: 0.5 }, // Pluie arcanique : +50 % de chance d'effet.
  // Nova arcanique : les ennemis touchés infligent −10 % de dégâts (1 tour).
  'MAG-A06': { targetModifier: { duration: 1, damageDealt: -0.1 } },
  'MAG-A07': { guaranteedOnPrimary: true }, // Météore : effet garanti sur la cible principale.
  'MAG-A08': { bonusVsAltered: 0.25 }, // Explosion arcanique : +25 % si la cible a une altération.
  // Tireur
  'TIR-A01': {}, // Tir rapide.
  'TIR-A02': { neverMiss: true, bonusCrit: 0.2 }, // Tir précis : ne rate jamais, +20 % de critique.
  'TIR-A03': {}, // Tir multiple : toute la vague.
  'TIR-A04': { hits: 2 }, // Double tir : deux flèches (2 × 45 %).
  // Tir perçant : ignore 30 % de l'Armure ; traverse et touche un 2e ennemi à 50 %.
  'TIR-A05': { armorIgnore: 0.3, extraTargets: { count: 1, share: 0.5 } },
  'TIR-A06': { bonusCrit: 0.1 }, // Volée de flèches : +10 % de critique.
  'TIR-A07': { guaranteedCrit: true }, // Tir mortel : critique garanti.
  'TIR-A08': { hits: 2 }, // Averse de flèches : toute la vague deux fois (2 × 75 %).
};

// ---------------------------------------------------------------------------
// Compétences de soutien
// ---------------------------------------------------------------------------

export const SUPPORT_EFFECTS: Record<string, SupportEffect> = {
  // Guerrier
  'GUE-S01': { duration: 2, buff: { duration: 2, stats: { resistance: 0.3 } } }, // Garde.
  'GUE-S02': { duration: ROUNDS, attack: { alterations: [{ id: 'assomme', chance: 0.25 }] } },
  // Cri de guerre (équipe) : +15 % de dégâts infligés pendant 2 tours.
  'GUE-S03': { duration: 2, buff: { duration: 2, damageDealt: 0.15 } },
  'GUE-S04': { duration: 2, shield: 0.12 }, // Mur de boucliers (équipe).
  'GUE-S05': { duration: ROUNDS, heal: 0.15 }, // Second souffle.
  'GUE-S06': { duration: 2, buff: { duration: 2, reflect: 0.3 } }, // Riposte.
  // Forteresse (équipe) : bouclier 20 % + immunité aux contrôles 2 tours.
  'GUE-S07': { duration: 2, shield: 0.2, buff: { duration: 2, controlImmune: true } },
  // Mage
  'MAG-S01': { duration: 2, shield: 0.12 }, // Barrière.
  'MAG-S02': { duration: ROUNDS, heal: 0.15 }, // Soin (équipe).
  'MAG-S03': { duration: 2, buff: { duration: 2, stats: { magic: 0.25 } } }, // Amplification.
  'MAG-S04': { duration: 2, targetModifier: { duration: 2, damageDealt: -0.15 } }, // Malédiction.
  'MAG-S05': { duration: 3, buff: { duration: 3, regen: 0.05 } }, // Régénération (équipe).
  'MAG-S06': { duration: ROUNDS, cleanse: true, heal: 0.06 }, // Purification (équipe).
  'MAG-S07': { duration: 2, heal: 0.25, shield: 0.1 }, // Sanctuaire (équipe).
  // Tireur
  // Œil de faucon (équipe) : +15 % de Précision et +10 % de critique pendant 2 tours.
  'TIR-S01': { duration: 2, buff: { duration: 2, stats: { accuracy: 0.15 }, critChance: 0.1 } },
  'TIR-S02': { duration: 1, buff: { duration: 1, dodge: 0.4 } }, // Roulade.
  // Flèche marquante : la cible subit +15 % de dégâts pendant 2 tours.
  'TIR-S03': { duration: 2, attack: {}, targetModifier: { duration: 2, damageTaken: 0.15 } },
  // Piège à loup : Enraciné + Saignement (3 tours).
  'TIR-S04': {
    duration: 3,
    attack: {
      alterations: [
        { id: 'enracine', chance: 1 },
        { id: 'saignement', chance: 1, duration: 3 },
      ],
    },
  },
  'TIR-S05': { duration: ROUNDS, heal: 0.08 }, // Remède (équipe).
  // Visée : la prochaine attaque inflige +50 %.
  'TIR-S06': { duration: 3, buff: { duration: 3, nextAttackBonus: 0.5 } },
  // Instinct du prédateur : +30 % de dégâts et +20 % de critique pendant 3 tours.
  'TIR-S07': { duration: 3, buff: { duration: 3, damageDealt: 0.3, critChance: 0.2 } },
};

// ---------------------------------------------------------------------------
// Effet de l'élément (onglet Éléments) : attaques et soutiens
// ---------------------------------------------------------------------------

export const ELEMENT_ATTACK_EFFECTS: Record<ElementId, AttackEffect> = {
  // Neutre : ignore 10 % de la Résistance (COMBAT_RULES.neutralResistanceIgnore).
  neutral: {},
  earth: { alterations: [{ id: 'garde_brisee', chance: 0.3 }] },
  fire: { alterations: [{ id: 'brulure', chance: 0.35 }] },
  wind: { bonusCrit: 0.1, alterations: [{ id: 'desoriente', chance: 0.3 }] },
  acid: { alterations: [{ id: 'corrosion', chance: 0.5 }] },
  water: { alterations: [{ id: 'mouille', chance: 0.5 }] },
  ice: { alterations: [{ id: 'froid', chance: 0.4 }] },
  lightning: {
    extraTargets: { count: 1, share: 0.4 },
    alterations: [{ id: 'etourdissement', chance: 0.1 }],
  },
  light: { lifesteal: 0.05, alterations: [{ id: 'eblouissement', chance: 0.25 }] },
  shadow: { lifesteal: 0.05, alterations: [{ id: 'corruption', chance: 0.3 }] },
};

export const ELEMENT_SUPPORT_EFFECTS: Record<ElementId, SupportElementEffect> = {
  neutral: {},
  earth: { modifier: { stats: { armor: 0.15 } } },
  fire: { modifier: { thorns: { alterationId: 'brulure', chance: 0.4 } } },
  wind: { modifier: { stats: { agility: 0.1 } } },
  acid: { modifier: { thorns: { alterationId: 'corrosion', chance: 0.4 } } },
  water: { extraHeal: 0.04, removeBurn: true },
  ice: { modifier: { thorns: { alterationId: 'froid', chance: 0.4 } } },
  lightning: { modifier: { nextAttackBonus: 0.15 } },
  light: { healShieldBoost: 0.2 },
  shadow: { modifier: { thorns: { alterationId: 'corruption', chance: 0.25 } } },
};

// ---------------------------------------------------------------------------
// Passifs de classe et affinités
// ---------------------------------------------------------------------------

export const PASSIVE_EFFECTS: Record<string, PassiveEffect> = {
  // Guerrier
  'GUE-P01': { multiply: { resistance: 0.08 } }, // Peau dure.
  'GUE-P02': { lifesteal: 0.05 }, // Soif de sang.
  'GUE-P03': { counterAttack: { chance: 0.15, power: 0.5 } }, // Contre-attaque.
  'GUE-P04': { rage: { perTenth: 0.02, max: 0.15 } }, // Rage.
  'GUE-P05': { sunder: { value: 0.02, maxStacks: 5 } }, // Briseur de garde.
  'GUE-P06': { periodicShield: { share: 0.08, every: 3 } }, // Bouclier réflexe.
  'GUE-P07': { add: { penetration: 0.05, critDamage: 0.05 } }, // Maître d'armes.
  'GUE-P08': { regen: 0.03 }, // Endurance du vétéran.
  // Mage
  'MAG-P01': { multiply: { magic: 0.08 } }, // Concentration arcanique.
  'MAG-P02': { lifesteal: 0.04 }, // Siphon.
  'MAG-P03': { echo: { chance: 0.15, share: 0.5 } }, // Écho.
  'MAG-P04': { alterationExtraDuration: { rounds: 1 } }, // Persistance.
  'MAG-P05': { periodicShield: { share: 0.06, every: 3 } }, // Égide arcanique.
  'MAG-P06': { add: { healingBonus: 0.1 } }, // Sagesse.
  'MAG-P07': { cooldownReduction: { every: 3 } }, // Accélération.
  'MAG-P08': { sunder: { value: 0.03, maxStacks: 5 } }, // Érosion magique.
  // Tireur
  'TIR-P01': { add: { critChance: 0.05 } }, // Œil vif.
  'TIR-P02': { bonusVsAltered: 0.15 }, // Chasseur.
  'TIR-P03': { firstShotCrit: true }, // Premier sang.
  'TIR-P04': { add: { dodgeBonus: 0.05 } }, // Pas léger.
  'TIR-P05': { critBleed: true }, // Pointes barbelées.
  'TIR-P06': { freeShot: { every: 2, power: 0.5 } }, // Carquois sans fond.
  'TIR-P07': { add: { critDamage: 0.2 } }, // Précision mortelle.
  'TIR-P08': { critHeal: 0.1 }, // Vampirisme.
  // Affinités élémentaires (toutes classes)
  'TOU-AFF-NEU': {
    elementDamage: { element: 'neutral', bonus: 0.08 },
    neutralResistanceIgnore: 0.1,
  },
  'TOU-AFF-TER': { elementDamage: { element: 'earth', bonus: 0.1 }, multiply: { armor: 0.05 } },
  'TOU-AFF-FEU': {
    elementDamage: { element: 'fire', bonus: 0.1 },
    alterationExtraDuration: { rounds: 1, only: 'brulure' },
  },
  'TOU-AFF-VEN': { elementDamage: { element: 'wind', bonus: 0.1 }, add: { critChance: 0.03 } },
  'TOU-AFF-ACI': { elementDamage: { element: 'acid', bonus: 0.1 }, corrosionMaxStacks: 5 },
  'TOU-AFF-EAU': { elementDamage: { element: 'water', bonus: 0.1 }, healReceived: 0.1 },
  'TOU-AFF-GLA': { elementDamage: { element: 'ice', bonus: 0.1 }, freezeAt: 2 },
  'TOU-AFF-ELE': { elementDamage: { element: 'lightning', bonus: 0.1 }, bounceBonus: 0.1 },
  'TOU-AFF-LUM': { elementDamage: { element: 'light', bonus: 0.1 }, add: { healingBonus: 0.1 } },
  'TOU-AFF-OMB': { elementDamage: { element: 'shadow', bonus: 0.1 }, lifesteal: 0.03 },
};

// ---------------------------------------------------------------------------
// Fusions (onglet Fusions) : remplacent l'effet de l'élément ; puissance ×1,10
// ---------------------------------------------------------------------------

const all = (id: string, chance: number, extra: Partial<AlterationSpec> = {}): AlterationSpec => ({
  id,
  chance,
  allEnemies: true,
  ...extra,
});

/** Clé d'une fusion : les deux éléments triés (Feu + Électricité = Électricité + Feu). */
export function fusionKey(a: ElementId, b: ElementId): string {
  return [a, b].sort().join('+');
}

const FUSIONS: [ElementId, ElementId, AttackEffect][] = [
  // Brasier : Brûlure renforcée (12 %) ; passe à un autre ennemi si la cible meurt en brûlant.
  [
    'fire',
    'fire',
    { alterations: [{ id: 'brulure', chance: 0.35, value: 0.12 }], deathSpread: ['brulure'] },
  ],
  // Plasma : rebondit sur 1 ennemi (50 %) ; chaque cible : 35 % Brûlure.
  [
    'fire',
    'lightning',
    { extraTargets: { count: 1, share: 0.5 }, alterations: [{ id: 'brulure', chance: 0.35 }] },
  ],
  // Brimstone : explosion de 40 % sur les autres ennemis si 2 piles de Corrosion (consommées).
  ['fire', 'acid', { special: 'brimstone' }],
  // Cryopyre : consomme le Froid (ou le Gel) : +20 % de dégâts par pile.
  ['fire', 'ice', { special: 'cryopyre' }],
  // Vapeur : nuage 2 tours : 5 % de la stat d'attaque par tour et −10 % de Précision à tous.
  [
    'fire',
    'water',
    { allEnemiesModifier: { duration: 2, dotShare: 0.05, stats: { accuracy: -0.1 } } },
  ],
  // Feu follet : la Brûlure touche aussi 1 ennemi supplémentaire.
  ['fire', 'wind', { alterations: [{ id: 'brulure', chance: 0.35 }], spread: { id: 'brulure' } }],
  // Magma : lave 2 tours (6 % de la stat d'attaque à chaque attaque ennemie) ; 25 % Garde brisée.
  [
    'fire',
    'earth',
    {
      allEnemiesModifier: { duration: 2, onAttackShare: 0.06 },
      alterations: [{ id: 'garde_brisee', chance: 0.25 }],
    },
  ],
  // Feu maudit : Brûlure + Corruption ; la Corruption passe à un autre ennemi à la mort.
  [
    'fire',
    'shadow',
    {
      alterations: [
        { id: 'brulure', chance: 0.35 },
        { id: 'corruption', chance: 0.3 },
      ],
      deathSpread: ['corruption'],
    },
  ],
  // Feu solaire : +15 % de dégâts ; dissipe 1 effet positif.
  ['fire', 'light', { damageBonus: 0.15, dispel: 1 }],
  // Flamme arcanique : 35 % Brûlure ; ignore 15 % de la Résistance.
  ['fire', 'neutral', { alterations: [{ id: 'brulure', chance: 0.35 }], resistanceIgnore: 0.15 }],
  // Foudre : Étourdissement 20 % ; +10 % de critique.
  [
    'lightning',
    'lightning',
    { alterations: [{ id: 'etourdissement', chance: 0.2 }], bonusCrit: 0.1 },
  ],
  // Flux corrosif : rebondit sur 1 ennemi ; 1 pile de Corrosion par cible.
  [
    'lightning',
    'acid',
    { extraTargets: { count: 1, share: 0.4 }, alterations: [{ id: 'corrosion', chance: 1 }] },
  ],
  // Cryo-éclair : rebondit sur 1 ennemi ; 1 pile de Froid par cible.
  [
    'lightning',
    'ice',
    { extraTargets: { count: 1, share: 0.4 }, alterations: [{ id: 'froid', chance: 1 }] },
  ],
  // Orage : Mouillé puis frappe (+25 %) ; rebondit sur tous les ennemis Mouillés (50 %).
  [
    'lightning',
    'water',
    {
      preAlterations: [{ id: 'mouille', chance: 1 }],
      special: 'orage',
      extraTargets: { count: 9, share: 0.5, requires: 'mouille' },
    },
  ],
  // Tempête : 1 ennemi supplémentaire (60 %) ; 25 % Désorienté.
  [
    'lightning',
    'wind',
    { extraTargets: { count: 1, share: 0.6 }, alterations: [{ id: 'desoriente', chance: 0.25 }] },
  ],
  // Magnétisme : la cible inflige −20 % de dégâts 2 tours ; 10 % Étourdissement.
  [
    'lightning',
    'earth',
    {
      targetModifier: { duration: 2, damageDealt: -0.2 },
      alterations: [{ id: 'etourdissement', chance: 0.1 }],
    },
  ],
  // Foudre spectrale : ignore 20 % de l'Armure ; 20 % Corruption.
  ['lightning', 'shadow', { armorIgnore: 0.2, alterations: [{ id: 'corruption', chance: 0.2 }] }],
  // Arc céleste : bouclier de 10 % des dégâts infligés.
  ['lightning', 'light', { shieldFromDamage: 0.1 }],
  // Surcharge : 1 charge par utilisation ; à 3 charges, +60 % puis les charges sont vidées.
  ['lightning', 'neutral', { special: 'surcharge' }],
  // Corrosion : 2 piles par coup (6 piles max).
  ['acid', 'acid', { alterations: [{ id: 'corrosion', chance: 1, stacks: 2, maxStacks: 6 }] }],
  // Cryocorrosion : contre une cible avec Froid : −15 % de Résistance 2 tours ; 50 % Corrosion.
  [
    'acid',
    'ice',
    {
      targetModifier: { duration: 2, stats: { resistance: -0.15 }, requires: ['froid', 'gel'] },
      alterations: [{ id: 'corrosion', chance: 0.5 }],
    },
  ],
  // Solution caustique : 1 pile de Corrosion sur tous les ennemis (40 % chacun).
  ['acid', 'water', { alterations: [all('corrosion', 0.4)] }],
  // Brume toxique : 35 % de Poison sur tous les ennemis.
  ['acid', 'wind', { alterations: [all('poison', 0.35)] }],
  // Putréfaction : −10 % de Force et de Magie 3 tours ; 30 % Poison.
  [
    'acid',
    'earth',
    {
      targetModifier: { duration: 3, stats: { strength: -0.1, magic: -0.1 } },
      alterations: [{ id: 'poison', chance: 0.3 }],
    },
  ],
  // Fléau : Corrosion + Corruption ; une cible corrodée touchée passe 1 pile à un autre ennemi.
  [
    'acid',
    'shadow',
    {
      alterations: [
        { id: 'corrosion', chance: 0.5 },
        { id: 'corruption', chance: 0.3 },
      ],
      special: 'fleau',
    },
  ],
  // Alchimie : 10 % des dégâts en soin ; 30 % Corrosion.
  ['acid', 'light', { lifesteal: 0.1, alterations: [{ id: 'corrosion', chance: 0.3 }] }],
  // Dissolution : ignore 25 % de l'Armure et détruit les boucliers.
  ['acid', 'neutral', { armorIgnore: 0.25, destroyShield: true }],
  // Grand Gel : 2 piles de Froid par coup ; le Gel dure 1 tour de plus (hors boss).
  ['ice', 'ice', { alterations: [{ id: 'froid', chance: 1, stacks: 2, longFreeze: true }] }],
  // Glacier : Mouillé + Froid ; une cible déjà Mouillée prend 2 piles de Froid.
  ['ice', 'water', { special: 'glacier' }],
  // Blizzard : 1 pile de Froid sur tous les ennemis ; 20 % Désorienté.
  ['ice', 'wind', { alterations: [all('froid', 1), { id: 'desoriente', chance: 0.2 }] }],
  // Permafrost : +25 % d'Armure au lanceur 2 tours ; 40 % Froid.
  [
    'ice',
    'earth',
    {
      selfModifier: { duration: 2, stats: { armor: 0.25 } },
      alterations: [{ id: 'froid', chance: 0.4 }],
    },
  ],
  // Froid spectral : une cible froide ou gelée inflige −20 % 2 tours ; 20 % Corruption.
  [
    'ice',
    'shadow',
    {
      targetModifier: { duration: 2, damageDealt: -0.2, requires: ['froid', 'gel'] },
      alterations: [{ id: 'corruption', chance: 0.2 }],
    },
  ],
  // Cristal sacré : bouclier 8 % ; renvoie 15 % du prochain coup reçu.
  ['ice', 'light', { selfShield: 0.08, selfModifier: { duration: 2, reflectNextHit: 0.15 } }],
  // Zéro absolu : contre une seule cible, 25 % de Gel direct.
  ['ice', 'neutral', { alterations: [{ id: 'gel', chance: 0.25, singleTargetOnly: true }] }],
  // Marée : soin 8 % ; Mouillé sur tous les ennemis.
  ['water', 'water', { selfHeal: 0.08, alterations: [all('mouille', 1)] }],
  // Typhon : prochaine attaque de zone +25 % ; 50 % Mouillé.
  [
    'water',
    'wind',
    {
      selfModifier: { duration: 3, nextAreaBonus: 0.25 },
      alterations: [{ id: 'mouille', chance: 0.5 }],
    },
  ],
  // Bourbier : Enraciné et la cible joue en dernier 2 tours.
  [
    'water',
    'earth',
    {
      alterations: [{ id: 'enracine', chance: 1 }],
      targetModifier: { duration: 2, playsLast: true },
    },
  ],
  // Eau noire : Poison 3 tours ; passe à un autre ennemi si la cible est Corrompue.
  [
    'water',
    'shadow',
    {
      alterations: [{ id: 'poison', chance: 1, duration: 3 }],
      spread: { id: 'poison', requires: 'corruption' },
    },
  ],
  // Eau bénite : soin 6 % ; +30 % contre l'Ombre.
  ['water', 'light', { selfHeal: 0.06, bonusVsElement: { element: 'shadow', bonus: 0.3 } }],
  // Onde arcanique : 1 ennemi supplémentaire (70 %) ; retire 1 altération du lanceur.
  ['water', 'neutral', { extraTargets: { count: 1, share: 0.7 }, cleanseSelf: 1 }],
  // Ouragan : +20 % de critique ; 25 % Désorienté sur tous les ennemis.
  ['wind', 'wind', { bonusCrit: 0.2, alterations: [all('desoriente', 0.25)] }],
  // Tempête de sable : −20 % de Précision à tous les ennemis 2 tours.
  ['wind', 'earth', { allEnemiesModifier: { duration: 2, stats: { accuracy: -0.2 } } }],
  // Vent funeste : 1 ennemi de plus (70 %) ; −15 % d'Agilité aux cibles.
  [
    'wind',
    'shadow',
    {
      extraTargets: { count: 1, share: 0.7 },
      targetModifier: { duration: 2, stats: { agility: -0.15 } },
    },
  ],
  // Ailes célestes : +20 % d'Agilité et +10 % d'esquive 2 tours.
  ['wind', 'light', { selfModifier: { duration: 2, stats: { agility: 0.2 }, dodge: 0.1 } }],
  // Lame d'air : ignore 15 % de l'Armure ; 1 ennemi supplémentaire (50 %).
  ['wind', 'neutral', { armorIgnore: 0.15, extraTargets: { count: 1, share: 0.5 } }],
  // Séisme : 15 % Assommé par cible ; 30 % Garde brisée.
  [
    'earth',
    'earth',
    {
      alterations: [
        { id: 'assomme', chance: 0.15 },
        { id: 'garde_brisee', chance: 0.3 },
      ],
    },
  ],
  // Tombeau : Enraciné + Corruption 2 tours ; 15 % Assommé.
  [
    'earth',
    'shadow',
    {
      alterations: [
        { id: 'enracine', chance: 1 },
        { id: 'corruption', chance: 1 },
        { id: 'assomme', chance: 0.15 },
      ],
    },
  ],
  // Bastion sacré : bouclier de 12 %.
  ['earth', 'light', { selfShield: 0.12 }],
  // Gravité : la prochaine attaque de zone frappe plus fort (+20 %) ; −15 % d'Agilité aux cibles.
  [
    'earth',
    'neutral',
    {
      selfModifier: { duration: 3, nextAreaBonus: 0.2 },
      targetModifier: { duration: 2, stats: { agility: -0.15 } },
    },
  ],
  // Néant : Corruption renforcée (+15 %) ; passe à un autre ennemi à la mort de la cible.
  [
    'shadow',
    'shadow',
    { alterations: [{ id: 'corruption', chance: 0.3, value: 0.15 }], deathSpread: ['corruption'] },
  ],
  // Crépuscule : manches impaires +20 % ; paires : Corruption et soin de 5 %.
  ['shadow', 'light', { special: 'crepuscule' }],
  // Distorsion : 20 % Terreur ; une seule fois par combat sur un boss.
  ['shadow', 'neutral', { special: 'distortion' }],
  // Révélation : soin 10 % ; 30 % Éblouissement.
  ['light', 'light', { selfHeal: 0.1, alterations: [{ id: 'eblouissement', chance: 0.3 }] }],
  // Équilibre : réduit de 1 la recharge d'une autre compétence (tous les 3 tours).
  ['light', 'neutral', { special: 'equilibre' }],
  // Singularité : +25 % ; ignore l'avantage et la résistance élémentaires.
  ['neutral', 'neutral', { damageBonus: 0.25, ignoreElement: true }],
];

export const FUSION_EFFECTS: Record<string, AttackEffect> = Object.fromEntries(
  FUSIONS.map(([a, b, effect]) => [fusionKey(a, b), effect]),
);
