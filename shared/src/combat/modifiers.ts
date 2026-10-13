/**
 * Effets temporaires des compétences (bonus, malus), boucliers à durée limitée.
 * Une même origine (`key`) ne se cumule pas : la relancer rafraîchit la durée,
 * sauf pour les effets à piles (Briseur de garde, Érosion magique).
 */
import type { CombatEvent, CombatModifier, Combatant, ModifierStat } from './types.ts';

/** Description d'un effet temporaire dans les tables d'effets (la durée vient de la compétence). */
export type ModifierSpec = Omit<
  CombatModifier,
  'key' | 'skillId' | 'kind' | 'remaining' | 'stacks' | 'maxStacks' | 'dot' | 'onAttackDamage'
> & {
  duration: number;
  maxStacks?: number;
  /** Dégâts par manche : part de la stat d'attaque du lanceur. */
  dotShare?: number;
  /** Dégâts quand le monstre attaque : part de la stat d'attaque du lanceur. */
  onAttackShare?: number;
};

/** Stat d'attaque d'un combattant (la plus haute de Force et Magie). */
export function attackStatOf(c: Combatant): number {
  return Math.max(c.stats.strength, c.stats.magic);
}

/**
 * Pose (ou rafraîchit) un effet temporaire. `kind` : bonus sur un allié, malus sur un ennemi.
 * Renvoie l'effet posé.
 */
export function addModifier(
  source: Combatant,
  target: Combatant,
  key: string,
  skillId: string | null,
  kind: 'buff' | 'debuff',
  spec: ModifierSpec,
  events: CombatEvent[],
): CombatModifier {
  const { duration, maxStacks = 1, dotShare, onAttackShare, ...effects } = spec;
  const attack = attackStatOf(source);
  const existing = target.modifiers.find((m) => m.key === key);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.stacks = Math.min(existing.maxStacks, existing.stacks + 1);
    if (dotShare) existing.dot = Math.max(existing.dot ?? 0, Math.round(dotShare * attack));
    if (onAttackShare)
      existing.onAttackDamage = Math.max(
        existing.onAttackDamage ?? 0,
        Math.round(onAttackShare * attack),
      );
    events.push({ type: 'modifier', targetId: target.id, key, skillId, kind });
    return existing;
  }
  const modifier: CombatModifier = {
    key,
    skillId,
    kind,
    remaining: duration,
    stacks: 1,
    maxStacks,
    ...effects,
    ...(dotShare ? { dot: Math.max(1, Math.round(dotShare * attack)) } : {}),
    ...(onAttackShare ? { onAttackDamage: Math.max(1, Math.round(onAttackShare * attack)) } : {}),
  };
  target.modifiers.push(modifier);
  events.push({ type: 'modifier', targetId: target.id, key, skillId, kind });
  return modifier;
}

/** Multiplicateur d'une stat dû aux effets temporaires. */
export function modifierStatFactor(c: Combatant, stat: ModifierStat): number {
  let factor = 1;
  for (const m of c.modifiers) {
    const value = m.stats?.[stat];
    if (value) factor *= Math.max(0, 1 + value * m.stacks);
  }
  return factor;
}

/** Somme d'un bonus additif des effets temporaires (× piles). */
export function modifierSum(
  c: Combatant,
  field: 'critChance' | 'dodge' | 'damageDealt' | 'damageTaken' | 'reflect' | 'regen',
): number {
  return c.modifiers.reduce((sum, m) => sum + (m[field] ?? 0) * m.stacks, 0);
}

export function isControlImmune(c: Combatant): boolean {
  return c.modifiers.some((m) => m.controlImmune);
}

/** Consomme les bonus « prochaine attaque » (et « prochaine attaque de zone » si `area`). */
export function consumeNextAttackBonus(c: Combatant, area: boolean): number {
  let bonus = 0;
  for (const m of c.modifiers) {
    if (m.nextAttackBonus) {
      bonus += m.nextAttackBonus;
      m.nextAttackBonus = 0;
      m.remaining = 0;
    }
    if (area && m.nextAreaBonus) {
      bonus += m.nextAreaBonus;
      m.nextAreaBonus = 0;
      m.remaining = 0;
    }
  }
  c.modifiers = c.modifiers.filter((m) => m.remaining > 0);
  return bonus;
}

/** Bonus de dégâts en attente (affichage et IA), sans le consommer. */
export function pendingAttackBonus(c: Combatant, area: boolean): number {
  return c.modifiers.reduce(
    (sum, m) => sum + (m.nextAttackBonus ?? 0) + (area ? (m.nextAreaBonus ?? 0) : 0),
    0,
  );
}

/** Ajoute un bouclier (cumulable) qui disparaît au bout de `duration` manches. */
export function addShield(
  target: Combatant,
  amount: number,
  duration: number,
  events: CombatEvent[],
): void {
  const value = Math.max(1, Math.round(amount));
  target.shield += value;
  target.shieldRemaining = Math.max(target.shieldRemaining, duration);
  events.push({ type: 'shield', targetId: target.id, amount: value });
}

/** Soigne un combattant (plafonné aux PV max) ; renvoie les PV rendus. */
export function heal(
  source: Combatant,
  target: Combatant,
  amount: number,
  events: CombatEvent[],
): number {
  if (target.hp <= 0) return 0;
  const value = Math.min(target.stats.maxHp - target.hp, Math.max(0, Math.round(amount)));
  if (value <= 0) return 0;
  target.hp += value;
  events.push({ type: 'heal', sourceId: source.id, targetId: target.id, amount: value });
  return value;
}

/**
 * Fin de manche : dégâts sur la durée et soins des effets, puis les durées baissent ;
 * le bouclier expire à la fin de sa durée.
 */
export function tickModifiers(c: Combatant, events: CombatEvent[]): void {
  if (c.hp <= 0) return;
  for (const m of c.modifiers) {
    if (m.dot && c.hp > 0) {
      const amount = Math.max(1, Math.round(m.dot * m.stacks));
      c.hp = Math.max(0, c.hp - amount);
      events.push({
        type: 'damage',
        sourceId: null,
        targetId: c.id,
        amount,
        critical: false,
        elementMultiplier: 1,
        cause: 'alteration',
      });
    }
  }
  const regen = modifierSum(c, 'regen');
  if (regen > 0 && c.hp > 0) heal(c, c, c.stats.maxHp * regen, events);
  for (const m of c.modifiers) m.remaining -= 1;
  c.modifiers = c.modifiers.filter((m) => m.remaining > 0);
  if (c.shieldRemaining > 0) {
    c.shieldRemaining -= 1;
    if (c.shieldRemaining === 0) c.shield = 0;
  }
}
