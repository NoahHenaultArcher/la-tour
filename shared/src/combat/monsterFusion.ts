/**
 * Fusions ennemies (Abysse, décision du 15/10/2026) : un monstre qui possède une fusion (son élément
 * + un second élément) la déclenche au hasard en attaquant. Les effets sont ceux des fusions des
 * héros (effects.ts, FUSION_EFFECTS), retournés contre l'équipe : les « ennemis » sont les héros,
 * les effets « sur soi » vont au monstre. Les règles propres aux héros (recharges d'Équilibre) ont
 * un équivalent simple, signalé ci-dessous.
 */
import { ABYSS, ALPHA } from '../balance.ts';
import { chance, pick, type Rng } from '../rules/random.ts';
import {
  activeAlteration,
  cleanse,
  hasAlteration,
  removeAlteration,
  tryApplyAlteration,
} from './alterations.ts';
import { attack, directDamage, type AttackResult, type AttackSpec } from './damage.ts';
import { FUSION_EFFECTS, fusionKey, type AlterationSpec } from './effects.ts';
import { addModifier, addShield, consumeNextAttackBonus, heal } from './modifiers.ts';
import type { CombatData, CombatEvent, CombatState, Combatant } from './types.ts';

interface FusionCtx {
  data: CombatData;
  state: CombatState;
  events: CombatEvent[];
}

const alive = (c: Combatant) => c.hp > 0;

/** Chance qu'une attaque de ce monstre déclenche sa fusion (0 s'il n'en a pas). */
export function fusionTriggerChance(monster: Combatant): number {
  if (!monster.fusion) return 0;
  return monster.alpha === 'fused' ? ALPHA.fusedTrigger : ABYSS.fusionTrigger;
}

/** Le monstre déclenche-t-il sa fusion pour cette attaque ? */
export function rollMonsterFusion(rng: Rng, monster: Combatant): boolean {
  const probability = fusionTriggerChance(monster);
  return probability > 0 && chance(rng, probability);
}

/** Autre héros vivant au hasard (rebonds, propagations). */
function otherHero(rng: Rng, heroes: Combatant[], exclude: Combatant[]): Combatant | null {
  const candidates = heroes.filter((h) => alive(h) && !exclude.includes(h));
  return candidates.length > 0 ? pick(rng, candidates) : null;
}

/**
 * Attaque de fusion d'un monstre sur un héros : coups, rebonds, altérations et effets de la fusion.
 * `spec` : l'attaque normale du monstre (puissance, élément), que la fusion renforce.
 * Renvoie les coups portés (le moteur applique ensuite les altérations du monstre et les réactions).
 */
export function monsterFusionAttack(
  ctx: FusionCtx,
  monster: Combatant,
  primary: Combatant,
  base: AttackSpec,
): { target: Combatant; result: AttackResult }[] {
  const { data, state, events } = ctx;
  const rng = state.rng;
  const second = monster.fusion!;
  const effect = FUSION_EFFECTS[fusionKey(monster.element, second)] ?? {};
  events.push({ type: 'fusion', actorId: monster.id, element: monster.element, fusion: second });

  const heroes = state.heroes;
  const odd = state.round % 2 === 1;
  let actionBonus = consumeNextAttackBonus(monster, false) + (effect.damageBonus ?? 0);
  if (effect.special === 'surcharge') {
    // Surcharge : la 4e fusion frappe beaucoup plus fort.
    const charges = monster.counters.surcharge ?? 0;
    if (charges >= 3) actionBonus += 0.6;
    monster.counters.surcharge = charges >= 3 ? 0 : charges + 1;
  }
  if (effect.special === 'crepuscule' && odd) actionBonus += 0.2;
  if (effect.special === 'orage' && monster.element !== 'lightning') actionBonus += 0.25;
  const chanceFactor = 1 + (effect.alterationChanceBonus ?? 0);
  const hits = Math.max(1, effect.hits ?? 1);

  const tryAlteration = (target: Combatant, spec: AlterationSpec) => {
    if (spec.requires && !spec.requires.some((id) => activeAlteration(target, id))) return false;
    return tryApplyAlteration(
      data,
      rng,
      monster,
      target,
      spec.id,
      spec.chance * chanceFactor,
      events,
      {
        stacks: spec.stacks,
        value: spec.value,
        duration: spec.duration,
        maxStacks: spec.maxStacks,
        longFreeze: spec.longFreeze,
      },
    );
  };

  const results: { target: Combatant; result: AttackResult }[] = [];
  const strike = (target: Combatant, share: number): AttackResult => {
    let bonus = actionBonus;
    if (effect.executeBonus && target.hp / target.stats.maxHp < effect.executeBonus.below)
      bonus += effect.executeBonus.bonus;
    if (effect.bonusVsAltered && hasAlteration(target)) bonus += effect.bonusVsAltered;
    if (effect.bonusVsElement?.element === target.element) bonus += effect.bonusVsElement.bonus;
    if (effect.special === 'cryopyre') {
      const stacks =
        removeAlteration(target, 'froid', events) + 3 * removeAlteration(target, 'gel', events);
      bonus += 0.2 * stacks;
    }
    const corrodedBefore = activeAlteration(target, 'corrosion')?.stacks ?? 0;
    const wetBefore = activeAlteration(target, 'mouille') !== undefined;
    const result = attack(
      data,
      rng,
      monster,
      target,
      {
        ...base,
        power: (base.power / hits) * share,
        armorIgnore: base.armorIgnore + (effect.armorIgnore ?? 0),
        resistanceIgnore: base.resistanceIgnore + (effect.resistanceIgnore ?? 0),
        neverMiss: base.neverMiss || effect.neverMiss === true,
        bonusCrit: base.bonusCrit + (effect.bonusCrit ?? 0),
        guaranteedCrit: effect.guaranteedCrit,
        damageBonus: bonus,
        ignoreElement: effect.ignoreElement,
      },
      events,
    );
    results.push({ target, result });
    if (result.missed) return result;

    if (effect.lifesteal) heal(monster, monster, result.amount * effect.lifesteal, events);
    if (effect.shieldFromDamage)
      addShield(monster, result.amount * effect.shieldFromDamage, 2, events);
    if (effect.destroyShield) {
      target.shield = 0;
      target.shieldRemaining = 0;
    }
    if (effect.dispel) {
      let left = effect.dispel;
      target.modifiers = target.modifiers.filter((m) => m.kind !== 'buff' || left-- <= 0);
    }
    if (effect.special === 'fleau' && corrodedBefore > 0) {
      const other = otherHero(rng, heroes, [target]);
      const corrosion = activeAlteration(target, 'corrosion');
      if (other && corrosion) {
        corrosion.stacks -= 1;
        if (corrosion.stacks <= 0) removeAlteration(target, 'corrosion', events);
        tryApplyAlteration(data, rng, monster, other, 'corrosion', 1, events);
      }
    }
    if (effect.special === 'brimstone' && corrodedBefore >= 2) {
      removeAlteration(target, 'corrosion', events);
      for (const other of heroes.filter((h) => alive(h) && h !== target))
        directDamage(monster, other, result.amount * 0.4, events);
    }
    if (effect.special === 'glacier') {
      tryApplyAlteration(data, rng, monster, target, 'mouille', 1, events);
      tryAlteration(target, { id: 'froid', chance: 1, stacks: wetBefore ? 2 : 1 });
    }
    for (const a of effect.alterations ?? []) if (!a.allEnemies) tryAlteration(target, a);
    if (effect.special === 'distortion')
      tryApplyAlteration(data, rng, monster, target, 'terreur', 0.2, events);
    if (effect.special === 'crepuscule' && !odd)
      tryApplyAlteration(data, rng, monster, target, 'corruption', 1, events);
    return result;
  };

  for (const a of effect.preAlterations ?? []) tryAlteration(primary, a);
  const targets = [primary];
  const struck = new Set<Combatant>();
  for (let h = 0; h < hits && alive(primary); h++)
    if (!strike(primary, 1).missed) struck.add(primary);

  // Rebonds : d'autres héros, à une part des dégâts.
  if (effect.extraTargets) {
    const { count, share, requires } = effect.extraTargets;
    for (let i = 0; i < count; i++) {
      const pool = heroes.filter(
        (h) =>
          alive(h) &&
          !targets.includes(h) &&
          (!requires || activeAlteration(h, requires) !== undefined),
      );
      if (pool.length === 0) break;
      const next = pick(rng, pool);
      targets.push(next);
      if (!strike(next, share).missed) struck.add(next);
    }
  }

  // Altérations sur toute l'équipe (Blizzard, Brume toxique…).
  for (const a of effect.alterations ?? []) {
    if (!a.allEnemies) continue;
    for (const h of heroes.filter(alive)) tryAlteration(h, a);
  }

  // Propagation : la même altération sur un autre héros.
  if (effect.spread) {
    const { id, requires } = effect.spread;
    for (const target of struck) {
      if (!activeAlteration(target, id) || (requires && !activeAlteration(target, requires)))
        continue;
      const other = otherHero(rng, heroes, [...struck]);
      if (other) tryApplyAlteration(data, rng, monster, other, id, 1, events);
      break;
    }
  }

  // Effets temporaires : malus sur les héros touchés ou sur toute l'équipe, bonus sur le monstre.
  const key = `fusion:${fusionKey(monster.element, second)}`;
  if (effect.targetModifier) {
    const { requires, ...spec } = effect.targetModifier;
    for (const target of struck) {
      if (!alive(target)) continue;
      if (requires && !requires.some((id) => activeAlteration(target, id))) continue;
      addModifier(monster, target, key, null, 'debuff', spec, events);
    }
  }
  if (effect.allEnemiesModifier)
    for (const h of heroes.filter(alive))
      addModifier(monster, h, key, null, 'debuff', effect.allEnemiesModifier, events);
  if (effect.selfModifier)
    addModifier(monster, monster, key, null, 'buff', effect.selfModifier, events);

  // Effets sur le monstre.
  if (effect.selfHeal) heal(monster, monster, monster.stats.maxHp * effect.selfHeal, events);
  if (effect.special === 'crepuscule' && !odd)
    heal(monster, monster, monster.stats.maxHp * 0.05, events);
  if (effect.selfShield) addShield(monster, monster.stats.maxHp * effect.selfShield, 2, events);
  if (effect.cleanseSelf) cleanse(monster, effect.cleanseSelf, events);
  // Équilibre (réduit une recharge chez les héros) : un monstre n'a pas de recharge, il se purifie.
  if (effect.special === 'equilibre') cleanse(monster, 1, events);

  // À la mort d'un héros qui les porte, certaines altérations passent à un autre héros.
  for (const id of effect.deathSpread ?? []) {
    for (const target of struck) {
      if (alive(target) || !activeAlteration(target, id)) continue;
      const other = otherHero(rng, heroes, [target]);
      if (other) tryApplyAlteration(data, rng, monster, other, id, 1, events);
    }
  }
  return results;
}
