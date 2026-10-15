/**
 * Actions des héros : compétences d'attaque et de soutien, effets d'élément, fusions et passifs.
 * Réactions quand un monstre frappe un héros (renvoi, épines, contre-attaque) et effets
 * périodiques des passifs en fin de manche.
 */
import { ALCHEMY, COMBAT_RULES } from '../balance.ts';
import type { ElementId } from '../constants.ts';
import { eggDamageBonus, relicBonus } from '../rules/relics.ts';
import { chance, pick, type Rng } from '../rules/random.ts';
import {
  activeAlteration,
  cleanse,
  hasAlteration,
  removeAlteration,
  tryApplyAlteration,
  type AlterationOptions,
} from './alterations.ts';
import { attack, directDamage, type AttackResult, type AttackSpec } from './damage.ts';
import {
  ELEMENT_SUPPORT_EFFECTS,
  SUPPORT_EFFECTS,
  fusionKey,
  type AlterationSpec,
  type AttackEffect,
  type PassiveEffect,
} from './effects.ts';
import { addModifier, addShield, consumeNextAttackBonus, heal } from './modifiers.ts';
import {
  baseAttackEffect,
  dealsDamage,
  elementalAttackEffect,
  mergeEffects,
  passiveEffectsOf,
  passiveSum,
  skillById,
  type CatalogSkill,
} from './skills.ts';
import type { CombatData, CombatEvent, CombatSkill, CombatState, Combatant } from './types.ts';

export interface ActionCtx {
  data: CombatData;
  state: CombatState;
  events: CombatEvent[];
}

const alive = (c: Combatant) => c.hp > 0;

/** Soin d'un héros par lui-même : Bonus de soins et soins reçus compris. */
function selfHealAmount(hero: Combatant, passives: readonly PassiveEffect[], share: number) {
  const received = passiveSum(passives, (p) => p.healReceived);
  return hero.stats.maxHp * share * (1 + hero.stats.healingBonus) * (1 + received);
}

/** Autre ennemi vivant au hasard (rebonds, propagations). */
function otherEnemy(rng: Rng, enemies: Combatant[], exclude: Combatant[]): Combatant | null {
  const candidates = enemies.filter((e) => alive(e) && !exclude.includes(e));
  return candidates.length > 0 ? pick(rng, candidates) : null;
}

/** Réglages des altérations infligées par ce héros (passifs, fusion, Tour d'alchimie). */
function alterationOptions(
  alchemyLevel: number,
  passives: readonly PassiveEffect[],
  spec: AlterationSpec,
  fromFusion: boolean,
): AlterationOptions {
  let extraDuration = 0;
  for (const p of passives) {
    const extra = p.alterationExtraDuration;
    if (extra && (!extra.only || extra.only === spec.id)) extraDuration += extra.rounds;
  }
  if (fromFusion && alchemyLevel >= ALCHEMY.extraDurationLevel) extraDuration += 1;
  const corrosionMax = Math.max(0, ...passives.map((p) => p.corrosionMaxStacks ?? 0));
  const freezeAt = Math.min(...passives.map((p) => p.freezeAt ?? Infinity));
  return {
    stacks: spec.stacks,
    value: spec.value,
    duration: spec.duration,
    maxStacks:
      Math.max(spec.maxStacks ?? 0, spec.id === 'corrosion' ? corrosionMax : 0) || undefined,
    extraDuration: extraDuration || undefined,
    freezeAt: Number.isFinite(freezeAt) ? freezeAt : undefined,
    longFreeze: spec.longFreeze,
  };
}

// ---------------------------------------------------------------------------
// Compétences
// ---------------------------------------------------------------------------

/**
 * Lance une compétence du héros. `target` : la cible choisie (compétence mono-cible),
 * ou la cible principale d'une attaque de zone (facultative).
 */
export function useHeroSkill(
  ctx: ActionCtx,
  hero: Combatant,
  slot: CombatSkill,
  target: Combatant | null,
): void {
  const skill = skillById(ctx.data, slot.skillId);
  const passives = passiveEffectsOf(ctx.data, hero.passives);
  if (skill.family === 'support') {
    useSupport(ctx, hero, skill, target, passives);
    return;
  }
  performAttack(ctx, hero, skill, slot.fusion ?? null, target, passives);
}

function useSupport(
  ctx: ActionCtx,
  hero: Combatant,
  skill: CatalogSkill,
  target: Combatant | null,
  passives: readonly PassiveEffect[],
): void {
  const { events } = ctx;
  const support = SUPPORT_EFFECTS[skill.baseId] ?? { duration: COMBAT_RULES.defaultEffectRounds };
  const element = ELEMENT_SUPPORT_EFFECTS[skill.element];
  const boost = 1 + (element.healShieldBoost ?? 0);

  if (support.cleanse) cleanse(hero, hero.alterations.length, events);
  const healShare = (support.heal ?? 0) * boost + (element.extraHeal ?? 0);
  if (healShare > 0) heal(hero, hero, selfHealAmount(hero, passives, healShare), events);
  if (element.removeBurn) removeAlteration(hero, 'brulure', events);
  if (support.shield)
    addShield(hero, hero.stats.maxHp * support.shield * boost, support.duration, events);
  if (support.buff) addModifier(hero, hero, skill.baseId, skill.id, 'buff', support.buff, events);
  if (element.modifier) {
    addModifier(
      hero,
      hero,
      `element:${skill.baseId}`,
      skill.id,
      'buff',
      { duration: support.duration, ...element.modifier },
      events,
    );
  }

  let hit = target !== null && alive(target);
  if (dealsDamage(skill) && target) {
    hit = performAttack(ctx, hero, skill, null, target, passives).some((r) => !r.missed);
  }
  if (support.targetModifier && target && hit) {
    addModifier(hero, target, skill.baseId, skill.id, 'debuff', support.targetModifier, events);
  }
}

/**
 * Attaque complète d'une compétence : coups, rebonds, altérations, effets de fusion et passifs.
 * Renvoie le résultat de chaque coup porté.
 */
export function performAttack(
  ctx: ActionCtx,
  hero: Combatant,
  skill: CatalogSkill,
  fusion: ElementId | null,
  chosen: Combatant | null,
  passives: readonly PassiveEffect[],
): AttackResult[] {
  const { data, state, events } = ctx;
  const rng = state.rng;
  const base = baseAttackEffect(skill);
  const elemental = elementalAttackEffect(skill, fusion);
  const effect = mergeEffects(base, elemental);
  const area = skill.target === 'area';
  const living = state.monsters.filter(alive);
  if (living.length === 0) return [];
  const primary = chosen && alive(chosen) ? chosen : living[0]!;
  const targets = area ? living : [primary];
  const results: AttackResult[] = [];

  // Bonus valables pour toute l'action.
  const relics = relicBonus(state.relics ?? []);
  // Œufs de dragon : compétences de leur élément et fusions qui le contiennent.
  let actionBonus =
    consumeNextAttackBonus(hero, area) +
    (effect.damageBonus ?? 0) +
    eggDamageBonus(relics, skill.element, fusion);
  actionBonus += passiveSum(passives, (p) =>
    p.elementDamage?.element === skill.element ? p.elementDamage.bonus : 0,
  );
  const rage = passives.find((p) => p.rage)?.rage;
  if (rage) {
    const lostTenths = Math.floor(((1 - hero.hp / hero.stats.maxHp) * 100) / 10);
    actionBonus += Math.min(rage.max, lostTenths * rage.perTenth);
  }
  if (effect.special === 'surcharge') {
    const key = `surcharge:${skill.id}`;
    const charges = hero.counters[key] ?? 0;
    if (charges >= 3) {
      actionBonus += 0.6;
      hero.counters[key] = 0;
    } else {
      hero.counters[key] = charges + 1;
    }
  }
  const oddRound = state.round % 2 === 1;
  if (effect.special === 'crepuscule' && oddRound) actionBonus += 0.2;
  if (effect.special === 'orage' && skill.element !== 'lightning') actionBonus += 0.25;
  let firstShot = false;
  if (
    passives.some((p) => p.firstShotCrit) &&
    hero.counters.firstShotWave !== state.waveIndex + 1
  ) {
    firstShot = true;
    hero.counters.firstShotWave = state.waveIndex + 1;
  }

  const neutral = skill.element === 'neutral';
  const resistanceIgnore =
    (effect.resistanceIgnore ?? 0) +
    (neutral
      ? COMBAT_RULES.neutralResistanceIgnore +
        passiveSum(passives, (p) => p.neutralResistanceIgnore)
      : 0);
  const power = skill.power * (fusion ? data.skills.params.fusionPowerBonus : 1);
  const hits = Math.max(1, effect.hits ?? 1);
  const lifesteal =
    (effect.lifesteal ?? 0) + passiveSum(passives, (p) => p.lifesteal) + relics.lifesteal;
  const vsAltered = (effect.bonusVsAltered ?? 0) + passiveSum(passives, (p) => p.bonusVsAltered);
  const critHeal = passiveSum(passives, (p) => p.critHeal);
  const critBleed = passives.some((p) => p.critBleed);
  const sunder = passives.find((p) => p.sunder)?.sunder;
  const chanceFactor = 1 + (effect.alterationChanceBonus ?? 0) + relics.alterationChance;

  const tryAlteration = (target: Combatant, spec: AlterationSpec, fromElement: boolean) => {
    if (spec.singleTargetOnly && area) return false;
    if (spec.requires && !spec.requires.some((id) => activeAlteration(target, id))) return false;
    const guaranteed = fromElement && base.guaranteedOnPrimary === true && target === primary;
    const probability = guaranteed ? 1 : spec.chance * chanceFactor;
    const options = alterationOptions(
      hero.alchemyLevel ?? state.alchemyLevel,
      passives,
      spec,
      fromElement && fusion !== null,
    );
    return tryApplyAlteration(data, rng, hero, target, spec.id, probability, events, options);
  };

  /** Un coup sur une cible, à une part de la puissance ; applique tous les effets « au contact ». */
  const strike = (target: Combatant, share: number, withAlterations: boolean): AttackResult => {
    let bonus = actionBonus;
    if (effect.executeBonus && target.hp / target.stats.maxHp < effect.executeBonus.below)
      bonus += effect.executeBonus.bonus;
    if (vsAltered && hasAlteration(target)) bonus += vsAltered;
    if (effect.bonusVsElement?.element === target.element) bonus += effect.bonusVsElement.bonus;
    if (effect.special === 'cryopyre') {
      const stacks =
        removeAlteration(target, 'froid', events) + 3 * removeAlteration(target, 'gel', events);
      bonus += 0.2 * stacks;
    }
    const corrodedBefore = activeAlteration(target, 'corrosion')?.stacks ?? 0;
    const wetBefore = activeAlteration(target, 'mouille') !== undefined;

    const spec: AttackSpec = {
      power: (power / hits) * share,
      element: skill.element,
      elementalShare: neutral ? 0 : 1,
      armorIgnore: effect.armorIgnore ?? 0,
      resistanceIgnore,
      neverMiss: effect.neverMiss ?? false,
      bonusCrit: effect.bonusCrit ?? 0,
      guaranteedCrit: effect.guaranteedCrit || firstShot,
      damageBonus: bonus,
      ignoreElement: effect.ignoreElement,
    };
    firstShot = false;
    const result = attack(data, rng, hero, target, spec, events);
    results.push(result);
    if (result.missed) return result;

    if (lifesteal > 0) heal(hero, hero, result.amount * lifesteal, events);
    if (result.critical && critHeal > 0) heal(hero, hero, result.amount * critHeal, events);
    if (result.critical && critBleed)
      tryApplyAlteration(data, rng, hero, target, 'saignement', 1, events);
    if (sunder && alive(target)) {
      addModifier(
        hero,
        target,
        `sunder:${hero.id}`,
        null,
        'debuff',
        { duration: 99, maxStacks: sunder.maxStacks, stats: { resistance: -sunder.value } },
        events,
      );
    }
    if (effect.shieldFromDamage)
      addShield(
        hero,
        result.amount * effect.shieldFromDamage,
        COMBAT_RULES.defaultEffectRounds,
        events,
      );
    if (effect.destroyShield) {
      target.shield = 0;
      target.shieldRemaining = 0;
    }
    if (effect.dispel) {
      let left = effect.dispel;
      target.modifiers = target.modifiers.filter((m) => m.kind !== 'buff' || left-- <= 0);
    }
    if (effect.special === 'fleau' && corrodedBefore > 0) {
      const other = otherEnemy(rng, state.monsters, [target]);
      const corrosion = activeAlteration(target, 'corrosion');
      if (other && corrosion) {
        corrosion.stacks -= 1;
        if (corrosion.stacks <= 0) removeAlteration(target, 'corrosion', events);
        tryApplyAlteration(data, rng, hero, other, 'corrosion', 1, events);
      }
    }
    if (effect.special === 'brimstone' && corrodedBefore >= 2) {
      removeAlteration(target, 'corrosion', events);
      for (const other of state.monsters.filter((m) => alive(m) && m !== target))
        directDamage(hero, other, result.amount * 0.4, events);
    }

    if (withAlterations) {
      if (effect.special === 'glacier') {
        tryApplyAlteration(data, rng, hero, target, 'mouille', 1, events);
        tryAlteration(target, { id: 'froid', chance: 1, stacks: wetBefore ? 2 : 1 }, true);
      }
      for (const a of base.alterations ?? []) if (!a.allEnemies) tryAlteration(target, a, false);
      for (const a of elemental.alterations ?? [])
        if (!a.allEnemies) tryAlteration(target, a, true);
      if (effect.special === 'distortion') {
        const key = `distortion:${target.id}`;
        if (!target.isBoss || !hero.counters[key]) {
          if (tryApplyAlteration(data, rng, hero, target, 'terreur', 0.2, events) && target.isBoss)
            hero.counters[key] = 1;
        }
      }
      if (effect.special === 'crepuscule' && !oddRound)
        tryApplyAlteration(data, rng, hero, target, 'corruption', 1, events);
    }
    return result;
  };

  // Altérations posées avant de frapper (Orage : Mouillé).
  for (const target of targets)
    for (const a of effect.preAlterations ?? []) tryAlteration(target, a, true);

  const struck = new Set<Combatant>();
  for (let h = 0; h < hits; h++) {
    for (const target of targets) {
      if (!alive(target)) continue;
      // Rayon arcanique, Double tir : chaque impact a sa chance d'appliquer l'effet.
      if (!strike(target, 1, true).missed) struck.add(target);
    }
  }

  // Rebonds et traversées : d'autres ennemis, à une part des dégâts.
  if (effect.extraTargets) {
    const { count, share, requires } = effect.extraTargets;
    const bounce = share + passiveSum(passives, (p) => p.bounceBonus);
    for (let i = 0; i < count; i++) {
      const pool = state.monsters.filter(
        (m) =>
          alive(m) &&
          !targets.includes(m) &&
          !struck.has(m) &&
          (!requires || activeAlteration(m, requires)),
      );
      if (pool.length === 0) break;
      const next = pick(rng, pool);
      if (!strike(next, bounce, true).missed) struck.add(next);
      targets.push(next);
    }
  }

  // Écho : 15 % qu'un sort à recharge 1 frappe une seconde fois.
  const echo = passives.find((p) => p.echo)?.echo;
  if (echo && skill.cooldown === 1 && chance(rng, echo.chance)) {
    for (const target of [...struck]) if (alive(target)) strike(target, echo.share, false);
  }

  // Altérations sur toute la vague (Blizzard, Brume toxique…).
  for (const a of [...(base.alterations ?? []), ...(elemental.alterations ?? [])]) {
    if (!a.allEnemies) continue;
    for (const m of state.monsters.filter(alive))
      tryAlteration(m, a, elemental.alterations?.includes(a) ?? false);
  }

  // Propagations : la même altération sur un autre ennemi.
  if (elemental.spread) {
    const { id, requires } = elemental.spread;
    for (const target of struck) {
      if (!activeAlteration(target, id) || (requires && !activeAlteration(target, requires)))
        continue;
      const other = otherEnemy(rng, state.monsters, [...struck]);
      if (other) tryApplyAlteration(data, rng, hero, other, id, 1, events);
      break;
    }
  }

  // Effets temporaires.
  const fusionTag = fusion ? `fusion:${fusionKey(skill.element, fusion)}` : skill.baseId;
  for (const [source, key] of [
    [base, skill.baseId],
    [elemental, fusionTag],
  ] as [AttackEffect, string][]) {
    if (source.targetModifier) {
      const { requires, ...spec } = source.targetModifier;
      for (const target of struck) {
        if (!alive(target)) continue;
        if (requires && !requires.some((id) => activeAlteration(target, id))) continue;
        addModifier(hero, target, key, skill.id, 'debuff', spec, events);
      }
    }
    if (source.allEnemiesModifier) {
      for (const m of state.monsters.filter(alive))
        addModifier(hero, m, key, skill.id, 'debuff', source.allEnemiesModifier, events);
    }
    if (source.selfModifier)
      addModifier(hero, hero, key, skill.id, 'buff', source.selfModifier, events);
  }

  // Effets sur le lanceur.
  if (effect.selfHeal) heal(hero, hero, selfHealAmount(hero, passives, effect.selfHeal), events);
  if (effect.special === 'crepuscule' && !oddRound)
    heal(hero, hero, selfHealAmount(hero, passives, 0.05), events);
  if (effect.selfShield)
    addShield(hero, hero.stats.maxHp * effect.selfShield, COMBAT_RULES.defaultEffectRounds, events);
  if (effect.cleanseSelf) cleanse(hero, effect.cleanseSelf, events);
  if (effect.special === 'equilibre') {
    const last = hero.counters.equilibre ?? -Infinity;
    if (state.round - last >= 3) {
      const other = hero.skills
        .filter((s) => s.skillId !== skill.id && s.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining)[0];
      if (other) {
        other.remaining -= 1;
        hero.counters.equilibre = state.round;
      }
    }
  }

  // À la mort d'une cible, certaines altérations passent à un autre ennemi.
  for (const id of effect.deathSpread ?? []) {
    for (const target of struck) {
      if (alive(target) || !activeAlteration(target, id)) continue;
      const other = otherEnemy(rng, state.monsters, [target]);
      if (other) tryApplyAlteration(data, rng, hero, other, id, 1, events);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Réactions et effets périodiques
// ---------------------------------------------------------------------------

/**
 * Un combattant attaque : il subit d'abord la lave (Magma) qui le recouvre. Les monstres la reçoivent
 * des héros ; dans l'Abysse, les héros la reçoivent aussi des monstres qui ont la fusion Magma.
 */
export function beforeMonsterAttack(ctx: ActionCtx, monster: Combatant): void {
  for (const m of monster.modifiers) {
    if (m.onAttackDamage && alive(monster))
      directDamage(null, monster, m.onAttackDamage, ctx.events);
  }
}

/** Un monstre vient de toucher un héros : renvoi des dégâts, épines, contre-attaque. */
export function afterHeroHit(
  ctx: ActionCtx,
  monster: Combatant,
  hero: Combatant,
  damage: number,
): void {
  const { data, state, events } = ctx;
  if (damage <= 0 || !alive(monster)) return;
  const physicalShare =
    monster.attackType === 'physical'
      ? 1
      : monster.attackType === 'magical'
        ? 0
        : COMBAT_RULES.mixedPhysicalShare;
  let reflected = 0;
  for (const m of hero.modifiers) {
    if (m.reflect) reflected += damage * physicalShare * m.reflect * m.stacks;
    if (m.reflectNextHit) {
      reflected += damage * m.reflectNextHit;
      m.reflectNextHit = 0;
      m.remaining = 0;
    }
  }
  hero.modifiers = hero.modifiers.filter((m) => m.remaining > 0);
  if (reflected > 0) directDamage(hero, monster, reflected, events);
  for (const m of hero.modifiers) {
    if (m.thorns && alive(monster))
      tryApplyAlteration(
        data,
        state.rng,
        hero,
        monster,
        m.thorns.alterationId,
        m.thorns.chance,
        events,
      );
  }
  if (!alive(hero) || !alive(monster)) return;
  const counter = passiveEffectsOf(data, hero.passives).find((p) => p.counterAttack)?.counterAttack;
  if (counter && chance(state.rng, counter.chance)) {
    attack(data, state.rng, hero, monster, plainSpec(counter.power), events);
  }
}

/** Attaque simple, Neutre, sans effet (contre-attaque, tir gratuit). */
function plainSpec(power: number): AttackSpec {
  return {
    power,
    element: 'neutral',
    elementalShare: 0,
    armorIgnore: 0,
    resistanceIgnore: COMBAT_RULES.neutralResistanceIgnore,
    neverMiss: false,
    bonusCrit: 0,
  };
}

/** Fin de manche d'un héros : régénération, boucliers et tirs périodiques, Accélération. */
export function heroEndOfRound(ctx: ActionCtx, hero: Combatant): void {
  const { data, state, events } = ctx;
  if (!alive(hero)) return;
  const passives = passiveEffectsOf(data, hero.passives);
  const round = state.round;
  // Totem du haut chaman : régénération de toute l'équipe.
  const regen = relicBonus(state.relics ?? []).regen;
  if (regen > 0) heal(hero, hero, hero.stats.maxHp * regen, events);
  for (const p of passives) {
    if (p.regen) heal(hero, hero, hero.stats.maxHp * p.regen, events);
    if (p.periodicShield && round % p.periodicShield.every === 0)
      addShield(hero, hero.stats.maxHp * p.periodicShield.share, p.periodicShield.every, events);
    if (p.cooldownReduction && round % p.cooldownReduction.every === 0) {
      const longest = [...hero.skills].sort((a, b) => b.remaining - a.remaining)[0];
      if (longest && longest.remaining > 0) longest.remaining -= 1;
    }
    if (p.freeShot && round % p.freeShot.every === 0) {
      const targets = state.monsters.filter(alive);
      if (targets.length > 0) {
        const target = pick(state.rng, targets);
        events.push({ type: 'action', actorId: hero.id, skillId: null, targetIds: [target.id] });
        attack(data, state.rng, hero, target, plainSpec(p.freeShot.power), events);
      }
    }
  }
}
