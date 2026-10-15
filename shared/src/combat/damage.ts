/**
 * Dégâts. Réductions d'Armure et de Résistance comme le bestiaire : Réduction = X / (X + K),
 * K choisi pour que le monstre étalon du niveau de l'attaquant réduise de 20 % (Armure) et 15 % (Résistance).
 * Physique : Armure puis Résistance ; magique : Résistance seule. Pénétration : ignore une part de l'Armure.
 */
import { ALPHA, COMBAT_RULES } from '../balance.ts';
import type { ElementId } from '../constants.ts';
import { elementMultiplier } from '../rules/elements.ts';
import { clamp, levelFactor } from '../rules/math.ts';
import { chance, nextFloat, type Rng } from '../rules/random.ts';
import { alterationDamageFactors, effectiveStat, isDodgeCancelled } from './alterations.ts';
import { heal, modifierSum } from './modifiers.ts';
import type { CombatData, CombatEvent, Combatant } from './types.ts';

export interface AttackSpec {
  power: number;
  /** Élément de l'attaque et part élémentaire des dégâts (1 pour une compétence élémentaire). */
  element: ElementId;
  elementalShare: number;
  armorIgnore: number;
  resistanceIgnore: number;
  neverMiss: boolean;
  bonusCrit: number;
  /** Coup critique assuré (Tir mortel, Premier sang). */
  guaranteedCrit?: boolean;
  /** Bonus de dégâts multiplicatif (+0,5 = +50 %) : exécution, Rage, Visée… */
  damageBonus?: number;
  /** Ignore l'avantage et la résistance élémentaires (Singularité : toujours ×1). */
  ignoreElement?: boolean;
}

export interface AttackResult {
  /** Dégâts infligés (0 si l'attaque a raté). */
  amount: number;
  critical: boolean;
  missed: boolean;
}

/** Constantes K du niveau de l'attaquant. */
export function levelConstants(data: CombatData, level: number) {
  const std = data.monsters.params.standardMonster;
  const f = levelFactor(level, data.monsters.params.levelCurve);
  return {
    armor: (std.armor * f * (1 - std.armorReduction)) / std.armorReduction,
    resistance: (std.resistance * f * (1 - std.resistanceReduction)) / std.resistanceReduction,
    agility: std.agility * f,
  };
}

/** Esquive face à un attaquant de ce niveau : plafond × Agilité / (Agilité + K). */
export function dodgeFromAgility(
  data: Pick<CombatData, 'monsters'>,
  agility: number,
  attackerLevel: number,
): number {
  const std = data.monsters.params.standardMonster;
  const k =
    std.agility *
    levelFactor(attackerLevel, data.monsters.params.levelCurve) *
    COMBAT_RULES.dodgeAgilityMultiplier;
  return agility <= 0 ? 0 : (COMBAT_RULES.dodgeCap * agility) / (agility + k);
}

/** Esquive en combat (Agilité, passifs, effets temporaires), annulée par « Marqué ». */
export function dodgeChance(data: CombatData, defender: Combatant, attackerLevel: number): number {
  if (isDodgeCancelled(defender)) return 0;
  const dodge =
    dodgeFromAgility(data, effectiveStat(data, defender, 'agility'), attackerLevel) +
    defender.stats.dodgeBonus +
    modifierSum(defender, 'dodge');
  return clamp(dodge, 0, COMBAT_RULES.maxDodge);
}

export function hitChance(data: CombatData, attacker: Combatant, defender: Combatant): number {
  const accuracy = effectiveStat(data, attacker, 'accuracy');
  return clamp(
    accuracy * (1 - dodgeChance(data, defender, attacker.level)),
    COMBAT_RULES.minHitChance,
    1,
  );
}

/** Dégâts après Armure et Résistance, pour une part physique ou magique. */
function mitigate(
  data: CombatData,
  raw: number,
  kind: 'physical' | 'magical',
  attacker: Combatant,
  defender: Combatant,
  spec: AttackSpec,
): number {
  const k = levelConstants(data, attacker.level);
  const resistance =
    effectiveStat(data, defender, 'resistance') * (1 - Math.min(1, spec.resistanceIgnore));
  const afterResistance = raw * (1 - resistance / (resistance + k.resistance));
  if (kind === 'magical') return afterResistance;
  const armor =
    effectiveStat(data, defender, 'armor') *
    (1 - Math.min(1, attacker.stats.penetration)) *
    (1 - Math.min(1, spec.armorIgnore));
  return afterResistance * (1 - armor / (armor + k.armor));
}

/** Dégâts infligés aux points de vie (le bouclier absorbe d'abord). */
export function inflictDamage(target: Combatant, amount: number): void {
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  target.hp = Math.max(0, target.hp - (amount - absorbed));
}

/**
 * Une attaque complète : toucher, esquive, critique, réductions, élément, altérations de dégâts,
 * bonus de la Tour d'amélioration et écart aléatoire. Renvoie les dégâts (0 si raté).
 */
export function attack(
  data: CombatData,
  rng: Rng,
  attacker: Combatant,
  defender: Combatant,
  spec: AttackSpec,
  events: CombatEvent[],
): AttackResult {
  if (!spec.neverMiss && !chance(rng, hitChance(data, attacker, defender))) {
    events.push({ type: 'miss', sourceId: attacker.id, targetId: defender.id });
    return { amount: 0, critical: false, missed: true };
  }

  const physicalShare =
    attacker.attackType === 'physical'
      ? 1
      : attacker.attackType === 'magical'
        ? 0
        : COMBAT_RULES.mixedPhysicalShare;
  let damage = 0;
  if (physicalShare > 0) {
    damage += mitigate(
      data,
      effectiveStat(data, attacker, 'strength') * spec.power * physicalShare,
      'physical',
      attacker,
      defender,
      spec,
    );
  }
  if (physicalShare < 1) {
    damage += mitigate(
      data,
      effectiveStat(data, attacker, 'magic') * spec.power * (1 - physicalShare),
      'magical',
      attacker,
      defender,
      spec,
    );
  }

  // Élément : seule la part élémentaire subit l'avantage et la Résistance élémentaire.
  const multiplier = spec.ignoreElement
    ? 1
    : elementMultiplier(data.elements, spec.element, defender.element);
  const factors = alterationDamageFactors(data, attacker, defender);
  const lightning = spec.element === 'lightning' ? factors.lightning : 1;
  const elemental =
    spec.elementalShare *
    multiplier *
    lightning *
    (1 - Math.min(1, defender.stats.elementalResistance));
  damage *= 1 - spec.elementalShare + elemental;

  const critical =
    spec.guaranteedCrit === true ||
    chance(rng, clamp(effectiveStat(data, attacker, 'critChance') + spec.bonusCrit, 0, 1));
  if (critical) damage *= 1 + attacker.stats.critDamage;

  damage *= factors.dealt * factors.taken * (1 + (spec.damageBonus ?? 0));
  damage *= (1 + attacker.damageBonus) * (1 - defender.defenseBonus);
  const variance = COMBAT_RULES.damageVariance;
  damage *= 1 - variance + 2 * variance * nextFloat(rng);

  const amount = Math.max(1, Math.round(damage));
  inflictDamage(defender, amount);
  events.push({
    type: 'damage',
    sourceId: attacker.id,
    targetId: defender.id,
    amount,
    critical,
    elementMultiplier: multiplier,
    cause: 'attack',
  });
  if (defender.hp <= 0) events.push({ type: 'death', targetId: defender.id });
  alphaReactions(attacker, defender, amount, events);
  return { amount, critical, missed: false };
}

/** Abysse : alphas « Épines » (renvoi) et « Vampirique » (soin), miroir de la fusion Cristal sacré. */
function alphaReactions(
  attacker: Combatant,
  defender: Combatant,
  amount: number,
  events: CombatEvent[],
): void {
  if (defender.alpha === 'thorns' && attacker.side === 'hero' && attacker.hp > 0)
    directDamage(defender, attacker, amount * ALPHA.thorns, events);
  // Fusion d'un monstre de l'Abysse (Cristal sacré) : renvoie une part du prochain coup reçu.
  // Les renvois des héros sont gérés après le coup du monstre (actions.ts, afterHeroHit).
  if (defender.side === 'monster' && attacker.side === 'hero' && attacker.hp > 0) {
    const mirror = defender.modifiers.find((m) => m.reflectNextHit);
    if (mirror) {
      directDamage(defender, attacker, amount * mirror.reflectNextHit!, events);
      mirror.reflectNextHit = 0;
      mirror.remaining = 0;
      defender.modifiers = defender.modifiers.filter((m) => m.remaining > 0);
    }
  }
  if (attacker.alpha === 'vampiric' && attacker.hp > 0)
    heal(attacker, attacker, amount * ALPHA.vampiric, events);
}

/**
 * Dégâts directs, sans jet ni réduction (explosions, renvois, contre-coups) : ils passent
 * quand même par le bouclier. Renvoie les dégâts infligés.
 */
export function directDamage(
  source: Combatant | null,
  target: Combatant,
  amount: number,
  events: CombatEvent[],
): number {
  if (target.hp <= 0) return 0;
  const value = Math.max(1, Math.round(amount));
  inflictDamage(target, value);
  events.push({
    type: 'damage',
    sourceId: source?.id ?? null,
    targetId: target.id,
    amount: value,
    critical: false,
    elementMultiplier: 1,
    cause: 'attack',
  });
  if (target.hp <= 0) events.push({ type: 'death', targetId: target.id });
  return value;
}
