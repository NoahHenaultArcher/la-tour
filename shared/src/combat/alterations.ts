/**
 * Altérations (bestiaire, onglet Altérations) : valeurs, durées et cumuls viennent des données ;
 * ce fichier décrit seulement COMMENT chaque altération agit.
 */
import { COMBAT_RULES } from '../balance.ts';
import { chance, type Rng } from '../rules/random.ts';
import type { ActiveAlteration, CombatData, CombatEvent, Combatant } from './types.ts';

type ModifiedStat = 'resistance' | 'agility' | 'accuracy' | 'critChance' | 'armor';

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

function active(target: Combatant, id: string): ActiveAlteration | undefined {
  return target.alterations.find((a) => a.id === id);
}

/** Valeur effective d'une stat, altérations comprises. */
export function effectiveStat(data: CombatData, c: Combatant, stat: ModifiedStat): number {
  let value = c.stats[stat];
  for (const a of c.alterations) {
    const rule = ALTERATION_RULES[a.id];
    if (rule?.stat === stat) value *= Math.max(0, 1 - info(data, a.id).value * a.stacks);
    if (stat === 'accuracy' && a.id === 'eblouissement') value *= 1 - DAZZLE_ACCURACY_MALUS;
  }
  return value;
}

/** Multiplicateurs de dégâts liés aux altérations. */
export function alterationDamageFactors(
  data: CombatData,
  attacker: Combatant,
  defender: Combatant,
) {
  let dealt = 1;
  for (const a of attacker.alterations) {
    if (ALTERATION_RULES[a.id]?.damageDealt) dealt *= 1 - info(data, a.id).value;
  }
  let taken = 1;
  let lightning = 1;
  for (const a of defender.alterations) {
    const rule = ALTERATION_RULES[a.id];
    if (rule?.damageTaken) taken *= 1 + info(data, a.id).value;
    if (rule?.lightningTaken) lightning *= 1 + info(data, a.id).value;
  }
  return { dealt, taken, lightning };
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
): void {
  const rule = ALTERATION_RULES[alterationId];
  if (!rule || target.hp <= 0) return;
  let probability = baseChance * (1 - Math.min(1, target.stats.statusResistance));
  if (rule.kind === 'control') {
    if (target.controlImmunity > 0 || target.skipNextTurn) return;
    if (target.isBoss) probability *= COMBAT_RULES.bossControlFactor;
  }
  if (!chance(rng, probability)) return;
  applyAlteration(data, source, target, alterationId, events);
}

/** Applique une altération sans tirage (règles de cumul, de durée et d'interaction). */
export function applyAlteration(
  data: CombatData,
  source: Combatant | null,
  target: Combatant,
  alterationId: string,
  events: CombatEvent[],
): void {
  const rule = ALTERATION_RULES[alterationId]!;
  const alteration = info(data, alterationId);

  if (rule.kind === 'control') {
    target.skipNextTurn = true;
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

  const damagePerStack =
    rule.dot === 'sourceStrength'
      ? alteration.value * (source?.stats.strength ?? 0)
      : rule.dot === 'sourceAttack'
        ? alteration.value * Math.max(source?.stats.strength ?? 0, source?.stats.magic ?? 0)
        : rule.dot === 'maxHp'
          ? alteration.value * target.stats.maxHp
          : 0;

  const existing = active(target, alterationId);
  if (existing) {
    existing.stacks = Math.min(alteration.maxStacks, existing.stacks + 1);
    existing.remaining = alteration.duration;
    existing.damagePerStack = Math.max(existing.damagePerStack, damagePerStack);
  } else {
    target.alterations.push({
      id: alterationId,
      stacks: 1,
      remaining: alteration.duration,
      damagePerStack,
    });
  }
  const stacks = active(target, alterationId)!.stacks;
  events.push({ type: 'alteration', targetId: target.id, alterationId, stacks });

  // Froid : à 3 piles, la cible gèle.
  if (alterationId === 'froid' && stacks >= alteration.maxStacks) {
    target.alterations = target.alterations.filter((a) => a.id !== 'froid');
    if (target.controlImmunity === 0 && !target.skipNextTurn)
      applyAlteration(data, source, target, 'gel', events);
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
    c.skipNextTurn = false;
    c.stunnedThisPhase = true;
    c.lostLastTurn = true;
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
