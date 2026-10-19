/**
 * Altérations (bestiaire, onglet Altérations) : valeurs, durées et cumuls viennent des données ;
 * ce fichier décrit seulement COMMENT chaque altération agit.
 */
import { COMBAT_RULES } from '../balance.ts';
import { chance, type Rng } from '../rules/random.ts';
import { isControlImmune, modifierStatFactor, modifierSum } from './modifiers.ts';
import { UNIQUE, hasUnique } from './uniqueData.ts';
import type { ActiveAlteration, CombatData, CombatEvent, Combatant } from './types.ts';

type ModifiedStat =
  'resistance' | 'agility' | 'accuracy' | 'critChance' | 'armor' | 'strength' | 'magic';

/** Réglages d'une application d'altération (fusions, passifs). */
export interface AlterationOptions {
  /** Piles ajoutées d'un coup (2 piles de Corrosion…). */
  stacks?: number;
  /** Valeur remplaçant celle du bestiaire (Brûlure à 12 %, Corruption à 15 %). */
  value?: number;
  /** Piles maximum (Corrosion jusqu'à 5 ou 6 piles). */
  maxStacks?: number;
  /** Manches en plus (Persistance, Affinité ardente, Tour d'alchimie). */
  extraDuration?: number;
  /** Durée imposée (Poison de l'Eau noire : 3 tours). */
  duration?: number;
  /** Piles de Froid qui déclenchent le Gel (3 par défaut). */
  freezeAt?: number;
  /** Le Gel fait perdre un tour de plus (Grand Gel, hors boss). */
  longFreeze?: boolean;
  /** Dégâts par manche imposés (Pointes incendiaires : part des dégâts du coup). */
  damagePerStack?: number;
}

interface AlterationRule {
  kind: 'dot' | 'control' | 'debuff' | 'terror';
  /** Stat réduite de « valeur » par pile. */
  stat?: ModifiedStat;
  /** Dégâts sur la durée : base du calcul. */
  dot?: 'sourceStrength' | 'sourceAttack' | 'maxHp';
  damageDealt?: boolean;
  damageTaken?: boolean;
  lightningTaken?: boolean;
  dodgeCancelled?: boolean;
}

export const ALTERATION_RULES: Record<string, AlterationRule> = {
  saignement: { kind: 'dot', dot: 'sourceStrength' },
  assomme: { kind: 'control' },
  intimide: { kind: 'debuff', damageDealt: true },
  garde_brisee: { kind: 'debuff', stat: 'resistance' },
  enracine: { kind: 'debuff', stat: 'agility' },
  brulure: { kind: 'dot', dot: 'sourceAttack' },
  desoriente: { kind: 'debuff', stat: 'accuracy' },
  poison: { kind: 'dot', dot: 'maxHp' },
  corrosion: { kind: 'debuff', stat: 'armor' },
  mouille: { kind: 'debuff', lightningTaken: true },
  froid: { kind: 'debuff', stat: 'agility' },
  gel: { kind: 'control' },
  etourdissement: { kind: 'control' },
  // « −10 % de Précision et −20 % de Chance de critique » : la valeur (0,2) porte sur le critique.
  eblouissement: { kind: 'debuff', stat: 'critChance' },
  marque: { kind: 'debuff', dodgeCancelled: true },
  corruption: { kind: 'debuff', damageTaken: true },
  terreur: { kind: 'terror' },
};

/** Précision perdue sous Éblouissement (texte de l'effet). */
const DAZZLE_ACCURACY_MALUS = 0.1;

function info(data: CombatData, id: string) {
  const alteration = data.monsters.alterations.find((a) => a.id === id);
  if (!alteration) throw new Error(`Altération inconnue : ${id}`);
  return alteration;
}

export function activeAlteration(target: Combatant, id: string): ActiveAlteration | undefined {
  return target.alterations.find((a) => a.id === id);
}
const active = activeAlteration;

/** Valeur effective d'une stat : altérations et effets temporaires compris. */
export function effectiveStat(data: CombatData, c: Combatant, stat: ModifiedStat): number {
  let value = c.stats[stat];
  for (const a of c.alterations) {
    const rule = ALTERATION_RULES[a.id];
    if (rule?.stat === stat) value *= Math.max(0, 1 - alterationValue(data, a) * a.stacks);
    if (stat === 'accuracy' && a.id === 'eblouissement') value *= 1 - DAZZLE_ACCURACY_MALUS;
  }
  if (stat === 'critChance') return Math.max(0, value + modifierSum(c, 'critChance'));
  return value * modifierStatFactor(c, stat);
}

/** Valeur d'une altération active (celle du bestiaire, sauf si une fusion l'a renforcée). */
function alterationValue(data: CombatData, a: ActiveAlteration): number {
  return a.value ?? info(data, a.id).value;
}

/** Multiplicateurs de dégâts liés aux altérations et aux effets temporaires. */
export function alterationDamageFactors(
  data: CombatData,
  attacker: Combatant,
  defender: Combatant,
) {
  let dealt = 1 + modifierSum(attacker, 'damageDealt');
  for (const a of attacker.alterations) {
    if (ALTERATION_RULES[a.id]?.damageDealt) dealt *= 1 - alterationValue(data, a);
  }
  let taken = 1 + modifierSum(defender, 'damageTaken');
  let lightning = 1;
  for (const a of defender.alterations) {
    const rule = ALTERATION_RULES[a.id];
    if (rule?.damageTaken) taken *= 1 + alterationValue(data, a);
    if (rule?.lightningTaken) lightning *= 1 + alterationValue(data, a);
  }
  return { dealt: Math.max(0, dealt), taken: Math.max(0, taken), lightning };
}

/** Le combattant porte au moins une altération (Chasseur, Explosion arcanique). */
export function hasAlteration(c: Combatant): boolean {
  return c.alterations.length > 0;
}

/** Retire jusqu'à `count` altérations (les plus récentes d'abord) ; renvoie le nombre retiré. */
export function cleanse(c: Combatant, count: number, events: CombatEvent[]): number {
  const removed = c.alterations.slice(-count);
  if (removed.length === 0) return 0;
  c.alterations = c.alterations.slice(0, c.alterations.length - removed.length);
  if (removed.some((a) => ALTERATION_RULES[a.id]?.kind === 'control')) c.skipNextTurn = false;
  for (const a of removed)
    events.push({ type: 'alterationEnd', targetId: c.id, alterationId: a.id });
  events.push({ type: 'cleanse', targetId: c.id, count: removed.length });
  return removed.length;
}

/** Retire une altération précise (consommée par une fusion) ; renvoie ses piles. */
export function removeAlteration(c: Combatant, id: string, events: CombatEvent[]): number {
  const existing = active(c, id);
  if (!existing) return 0;
  c.alterations = c.alterations.filter((a) => a.id !== id);
  if (ALTERATION_RULES[id]?.kind === 'control') c.skipNextTurn = false;
  events.push({ type: 'alterationEnd', targetId: c.id, alterationId: id });
  return existing.stacks;
}

export function isDodgeCancelled(c: Combatant): boolean {
  return c.alterations.some((a) => ALTERATION_RULES[a.id]?.dodgeCancelled);
}

/**
 * Tente d'appliquer une altération. Chance réelle = chance × (1 − Résistance aux altérations).
 * Contrôles : immunité de 2 manches ensuite ; sur un boss, chance divisée par 2 (durée 1 → ½).
 */
export function tryApplyAlteration(
  data: CombatData,
  rng: Rng,
  source: Combatant,
  target: Combatant,
  alterationId: string,
  baseChance: number,
  events: CombatEvent[],
  options: AlterationOptions = {},
): boolean {
  const rule = ALTERATION_RULES[alterationId];
  if (!rule || target.hp <= 0) return false;
  let probability = baseChance * (1 - Math.min(1, target.stats.statusResistance));
  if (rule.kind === 'control') {
    if (!canBeControlled(target)) return false;
    if (target.isBoss) probability *= COMBAT_RULES.bossControlFactor;
  }
  if (!chance(rng, probability)) return false;
  applyAlteration(data, source, target, alterationId, events, options);
  return true;
}

/** Un contrôle peut-il encore toucher ce combattant (immunités, contrôle déjà en attente) ? */
export function canBeControlled(target: Combatant): boolean {
  return target.controlImmunity === 0 && !target.skipNextTurn && !isControlImmune(target);
}

/** Applique une altération sans tirage (règles de cumul, de durée et d'interaction). */
export function applyAlteration(
  data: CombatData,
  source: Combatant | null,
  target: Combatant,
  alterationId: string,
  events: CombatEvent[],
  options: AlterationOptions = {},
): void {
  const rule = ALTERATION_RULES[alterationId]!;
  const alteration = info(data, alterationId);

  if (rule.kind === 'control') {
    if (!canBeControlled(target)) return;
    // Volonté inflexible (Unique) : le premier contrôle subi pendant le combat est ignoré.
    if (hasUnique(target, UNIQUE.willpower) && !target.counters.willpowerUsed) {
      target.counters.willpowerUsed = 1;
      events.push({ type: 'uniquePassive', actorId: target.id, itemId: UNIQUE.willpower });
      events.push({ type: 'resisted', targetId: target.id, alterationId });
      return;
    }
    target.skipNextTurn = true;
    if (options.longFreeze && alterationId === 'gel' && !target.isBoss) target.extraSkips = 1;
    target.alterations = target.alterations.filter((a) => a.id !== alterationId);
    target.alterations.push({ id: alterationId, stacks: 1, remaining: 1, damagePerStack: 0 });
    events.push({ type: 'alteration', targetId: target.id, alterationId, stacks: 1 });
    return;
  }

  // Mouillé retire la Brûlure.
  if (alterationId === 'mouille' && active(target, 'brulure')) {
    target.alterations = target.alterations.filter((a) => a.id !== 'brulure');
    events.push({ type: 'alterationEnd', targetId: target.id, alterationId: 'brulure' });
  }

  const value = options.value ?? alteration.value;
  const damagePerStack =
    options.damagePerStack ??
    (rule.dot === 'sourceStrength'
      ? value * (source?.stats.strength ?? 0)
      : rule.dot === 'sourceAttack'
        ? value * Math.max(source?.stats.strength ?? 0, source?.stats.magic ?? 0)
        : rule.dot === 'maxHp'
          ? value * target.stats.maxHp
          : 0);
  const maxStacks = Math.max(
    alteration.maxStacks,
    options.maxStacks ?? 0,
    active(target, alterationId)?.maxStacks ?? 0,
  );
  const duration = (options.duration ?? alteration.duration) + (options.extraDuration ?? 0);
  const added = Math.max(1, options.stacks ?? 1);

  const existing = active(target, alterationId);
  if (existing) {
    existing.stacks = Math.min(maxStacks, existing.stacks + added);
    existing.remaining = Math.max(existing.remaining, duration);
    existing.damagePerStack = Math.max(existing.damagePerStack, damagePerStack);
    if (options.value !== undefined) existing.value = Math.max(existing.value ?? 0, value);
    if (maxStacks > alteration.maxStacks)
      existing.maxStacks = Math.max(existing.maxStacks ?? 0, maxStacks);
  } else {
    target.alterations.push({
      id: alterationId,
      stacks: Math.min(maxStacks, added),
      remaining: duration,
      damagePerStack,
      ...(options.value !== undefined ? { value } : {}),
      ...(maxStacks > alteration.maxStacks ? { maxStacks } : {}),
    });
  }
  const stacks = active(target, alterationId)!.stacks;
  events.push({ type: 'alteration', targetId: target.id, alterationId, stacks });

  // Froid : à 3 piles (2 avec l'Affinité glaciale, jamais moins de 3 sur un boss), la cible gèle.
  const freezeAt = target.isBoss
    ? alteration.maxStacks
    : Math.min(alteration.maxStacks, options.freezeAt ?? alteration.maxStacks);
  if (alterationId === 'froid' && stacks >= freezeAt) {
    target.alterations = target.alterations.filter((a) => a.id !== 'froid');
    if (canBeControlled(target))
      applyAlteration(data, source, target, 'gel', events, { longFreeze: options.longFreeze });
  }
}

/**
 * Début de la phase d'un camp : les contrôles en attente font perdre le tour,
 * la Terreur peut le faire perdre (jamais deux fois de suite).
 */
export function resolveTurnStart(
  data: CombatData,
  rng: Rng,
  c: Combatant,
  events: CombatEvent[],
): void {
  c.stunnedThisPhase = false;
  if (c.hp <= 0) return;
  if (c.skipNextTurn) {
    const control = c.alterations.find((a) => ALTERATION_RULES[a.id]?.kind === 'control');
    c.stunnedThisPhase = true;
    c.lostLastTurn = true;
    // Gel prolongé : un tour de plus avant que le contrôle (et l'immunité) ne se termine.
    if (c.extraSkips > 0) {
      c.extraSkips -= 1;
      events.push({ type: 'stunned', targetId: c.id, alterationId: control?.id ?? 'gel' });
      return;
    }
    c.skipNextTurn = false;
    c.controlImmunity = COMBAT_RULES.controlImmunityRounds + 1;
    c.alterations = c.alterations.filter((a) => ALTERATION_RULES[a.id]?.kind !== 'control');
    events.push({ type: 'stunned', targetId: c.id, alterationId: control?.id ?? 'assomme' });
    return;
  }
  const terror = active(c, 'terreur');
  if (terror && !c.lostLastTurn && chance(rng, info(data, 'terreur').value)) {
    c.stunnedThisPhase = true;
    c.lostLastTurn = true;
    events.push({ type: 'stunned', targetId: c.id, alterationId: 'terreur' });
    return;
  }
  c.lostLastTurn = false;
}

/** Fin de manche : dégâts sur la durée, puis les durées baissent et les altérations expirent. */
export function tickAlterations(c: Combatant, events: CombatEvent[]): void {
  if (c.hp <= 0) return;
  for (const a of c.alterations) {
    if (a.damagePerStack <= 0 || c.hp <= 0) continue;
    const amount = Math.max(1, Math.round(a.damagePerStack * a.stacks));
    c.hp = Math.max(0, c.hp - amount);
    events.push({
      type: 'damage',
      sourceId: null,
      targetId: c.id,
      amount,
      critical: false,
      elementMultiplier: 1,
      cause: 'alteration',
      alterationId: a.id,
    });
  }
  const remaining: ActiveAlteration[] = [];
  for (const a of c.alterations) {
    // Les contrôles disparaissent quand ils font perdre le tour, pas en fin de manche.
    if (ALTERATION_RULES[a.id]?.kind === 'control') {
      remaining.push(a);
      continue;
    }
    a.remaining -= 1;
    if (a.remaining > 0) remaining.push(a);
    else events.push({ type: 'alterationEnd', targetId: c.id, alterationId: a.id });
  }
  c.alterations = remaining;
  if (c.controlImmunity > 0) c.controlImmunity -= 1;
}
