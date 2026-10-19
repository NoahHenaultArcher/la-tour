/**
 * Déclencheurs des passifs d'objets Uniques (chiffres et lecture des textes : uniqueData.ts).
 * Le moteur (engine.ts) et les actions des héros (actions.ts) les appellent aux moments décrits
 * par chaque passif : début du combat, début de manche, avant et après une compétence, à chaque
 * coup porté, quand un monstre touche ou rate un héros, avant de compter les morts.
 * Les limites « 1 fois par combat / par manche » sont tenues dans les compteurs du héros.
 */
import { chance, pick } from '../rules/random.ts';
import { activeAlteration, cleanse, tryApplyAlteration } from './alterations.ts';
import { attack, directDamage, type AttackResult } from './damage.ts';
import { addModifier, addShield, heal } from './modifiers.ts';
import { skillById, type CatalogSkill } from './skills.ts';
import type { CombatData, CombatEvent, CombatSkill, CombatState, Combatant } from './types.ts';
import { UNIQUE, UNIQUE_PASSIVE_RULES as R, hasUnique, type UniqueId } from './uniqueData.ts';

interface Ctx {
  data: CombatData;
  state: CombatState;
  events: CombatEvent[];
}

const alive = (c: Combatant) => c.hp > 0;
const key = (id: UniqueId) => `unique:${id}`;

/** Annonce le passif (journal et texte flottant). */
function announce(ctx: Ctx, hero: Combatant, id: UniqueId): void {
  ctx.events.push({ type: 'uniquePassive', actorId: hero.id, itemId: id });
}

/** Ennemi vivant au hasard, hors `exclude`. */
function randomEnemy(ctx: Ctx, exclude: readonly Combatant[] = []): Combatant | null {
  const pool = ctx.state.monsters.filter((m) => alive(m) && !exclude.includes(m));
  return pool.length > 0 ? pick(ctx.state.rng, pool) : null;
}

/** Le passif n'a pas encore servi pendant cette manche ; le marque comme utilisé. */
function oncePerRound(ctx: Ctx, hero: Combatant, counter: string): boolean {
  if (hero.counters[counter] === ctx.state.round) return false;
  hero.counters[counter] = ctx.state.round;
  return true;
}

// ---------------------------------------------------------------------------
// Début du combat et des manches
// ---------------------------------------------------------------------------

/** Début du combat : Volonté inflexible (+15 % de Résistance pendant 3 manches). */
export function uniquesAtCombatStart(ctx: Ctx): void {
  for (const hero of ctx.state.heroes) {
    if (!hasUnique(hero, UNIQUE.willpower)) continue;
    addModifier(
      hero,
      hero,
      key(UNIQUE.willpower),
      null,
      'buff',
      { duration: R.willpower.rounds, stats: { resistance: R.willpower.resistance } },
      ctx.events,
    );
  }
}

/**
 * Début de manche : Sillage de braise, Piétinement givré, Marée apaisante (manche 1 puis toutes
 * les 4 manches), Marée montante.
 */
export function uniquesAtRoundStart(ctx: Ctx): void {
  const { data, state, events } = ctx;
  const rng = state.rng;
  for (const hero of state.heroes.filter(alive)) {
    const inflict = (id: UniqueId, probability: number, alterationId: string) => {
      if (!hasUnique(hero, id) || !chance(rng, probability)) return;
      const target = randomEnemy(ctx);
      if (!target) return;
      announce(ctx, hero, id);
      tryApplyAlteration(data, rng, hero, target, alterationId, 1, events);
    };
    inflict(UNIQUE.emberTrail, R.emberTrail.chance, 'brulure');
    inflict(UNIQUE.frostStomp, R.frostStomp.chance, 'froid');

    if (hasUnique(hero, UNIQUE.soothingTide) && (state.round - 1) % R.soothingTide.every === 0) {
      announce(ctx, hero, UNIQUE.soothingTide);
      cleanse(hero, 1, events);
      heal(hero, hero, hero.stats.maxHp * R.soothingTide.heal, events);
    }

    if (hasUnique(hero, UNIQUE.risingTide) && chance(rng, R.risingTide.chance)) {
      const waiting = hero.skills.filter(
        (s) => s.remaining > 0 && !skillById(data, s.skillId).ultimate,
      );
      if (waiting.length > 0) {
        announce(ctx, hero, UNIQUE.risingTide);
        pick(rng, waiting).remaining -= 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compétences du porteur
// ---------------------------------------------------------------------------

/**
 * Avant une compétence : Surcharge arcanique arme son bonus si les 5 charges sont réunies
 * (la compétence suivante les consomme). Renvoie l'état à passer à uniquesAfterSkill.
 */
export function uniquesBeforeSkill(hero: Combatant): { overloadReady: boolean } {
  const overloadReady =
    hasUnique(hero, UNIQUE.arcaneOverload) &&
    (hero.counters.overload ?? 0) >= R.arcaneOverload.charges;
  if (overloadReady) hero.counters.overloadArmed = 1;
  return { overloadReady };
}

/**
 * Après une compétence : charge de Surcharge arcanique, Tempête naissante (un éclair toutes les
 * 3 compétences), Pensée vive (recharge −1, jamais sous 1, ultimes exclues).
 */
export function uniquesAfterSkill(
  ctx: Ctx,
  hero: Combatant,
  slot: CombatSkill,
  skill: CatalogSkill,
  before: { overloadReady: boolean },
): void {
  const { data, state, events } = ctx;
  if (hasUnique(hero, UNIQUE.arcaneOverload)) {
    // Bonus non consommé (compétence sans dégâts) : il attend la compétence suivante.
    hero.counters.overloadArmed = 0;
    if (!before.overloadReady)
      hero.counters.overload = Math.min(
        R.arcaneOverload.charges,
        (hero.counters.overload ?? 0) + 1,
      );
  }
  if (!alive(hero)) return;

  if (hasUnique(hero, UNIQUE.risingStorm)) {
    const cast = Math.min(R.risingStorm.every, (hero.counters.stormCasts ?? 0) + 1);
    hero.counters.stormCasts = cast;
    const target = randomEnemy(ctx);
    if (cast >= R.risingStorm.every && target && oncePerRound(ctx, hero, 'stormRound')) {
      hero.counters.stormCasts = 0;
      announce(ctx, hero, UNIQUE.risingStorm);
      attack(
        data,
        state.rng,
        hero,
        target,
        {
          power: R.risingStorm.power,
          element: 'lightning',
          elementalShare: 1,
          armorIgnore: 0,
          resistanceIgnore: 0,
          neverMiss: true,
          bonusCrit: 0,
        },
        events,
      );
    }
  }

  if (
    hasUnique(hero, UNIQUE.quickThought) &&
    !skill.ultimate &&
    slot.remaining > 1 &&
    chance(state.rng, R.quickThought.chance)
  ) {
    announce(ctx, hero, UNIQUE.quickThought);
    slot.remaining -= 1;
  }
}

/** Bonus valables pour toute une attaque du porteur. */
export interface UniqueAttackBonus {
  damageBonus: number;
  neverMiss: boolean;
  /** Pas d'éclair : chance d'étourdir la cible principale. */
  stunChance: number;
}

/**
 * Bonus d'une attaque : Surcharge arcanique (+60 %, consomme les charges), Alternance (phase
 * d'Ombre, manches paires : +15 %), Pas d'éclair (1re attaque du combat : +30 % et 30 %
 * d'étourdir), Regard perçant (1re attaque de chaque manche : ne peut pas être esquivée).
 */
export function uniqueAttackBonus(ctx: Ctx, hero: Combatant): UniqueAttackBonus {
  const bonus: UniqueAttackBonus = { damageBonus: 0, neverMiss: false, stunChance: 0 };
  if (hero.counters.overloadArmed) {
    hero.counters.overloadArmed = 0;
    hero.counters.overload = 0;
    bonus.damageBonus += R.arcaneOverload.bonus;
    announce(ctx, hero, UNIQUE.arcaneOverload);
  }
  if (hasUnique(hero, UNIQUE.alternation) && ctx.state.round % 2 === 0)
    bonus.damageBonus += R.alternation.magicDamage;
  if (hasUnique(hero, UNIQUE.lightningStep) && !hero.counters.lightningStepUsed) {
    hero.counters.lightningStepUsed = 1;
    bonus.damageBonus += R.lightningStep.bonus;
    bonus.stunChance = R.lightningStep.stunChance;
    announce(ctx, hero, UNIQUE.lightningStep);
  }
  if (hasUnique(hero, UNIQUE.piercingGaze) && oncePerRound(ctx, hero, 'piercingRound'))
    bonus.neverMiss = true;
  return bonus;
}

/** Soins prodigués × ce facteur : Alternance (phase de Lumière, manches impaires : +15 %). */
export function uniqueHealingFactor(state: CombatState, healer: Combatant): number {
  return hasUnique(healer, UNIQUE.alternation) && state.round % 2 === 1
    ? 1 + R.alternation.healing
    : 1;
}

/**
 * Coup porté par le héros (touché) : Serment de sang, Transmutation, Morsure corrosive,
 * Regard maudit, Flamme vive, Traque givrée, Fioles corrosives, Pointes incendiaires,
 * Flèches spectrales.
 */
export function uniquesOnStrike(
  ctx: Ctx,
  hero: Combatant,
  target: Combatant,
  skill: CatalogSkill,
  result: AttackResult,
): void {
  const { data, state, events } = ctx;
  const rng = state.rng;
  const basic = (skill.cooldown ?? 0) === 0;
  const apply = (alterationId: string, probability: number, options = {}) =>
    tryApplyAlteration(data, rng, hero, target, alterationId, probability, events, options);

  if (hasUnique(hero, UNIQUE.bloodOath) && alive(hero)) {
    if (hero.counters.bloodOathRound !== state.round) {
      hero.counters.bloodOathRound = state.round;
      hero.counters.bloodOathHealed = 0;
    }
    const share =
      hero.hp / hero.stats.maxHp < R.bloodOath.lowHp
        ? R.bloodOath.lowHpLifesteal
        : R.bloodOath.lifesteal;
    const room = hero.stats.maxHp * R.bloodOath.maxPerRound - (hero.counters.bloodOathHealed ?? 0);
    if (room > 0)
      hero.counters.bloodOathHealed =
        (hero.counters.bloodOathHealed ?? 0) +
        heal(hero, hero, Math.min(room, result.amount * share), events);
  }
  if (hasUnique(hero, UNIQUE.transmutation) && hero.attackType !== 'physical' && alive(hero)) {
    const room = hero.stats.maxHp * R.transmutation.cap - hero.shield;
    const amount = Math.min(room, result.amount * R.transmutation.share);
    if (amount >= 1) addShield(hero, amount, R.transmutation.rounds, events);
  }

  if (hasUnique(hero, UNIQUE.corrosiveBite)) apply('corrosion', 1);
  if (hasUnique(hero, UNIQUE.cursedGaze)) apply('corruption', R.cursedGaze.chance);
  if (hasUnique(hero, UNIQUE.livingFlame) && skill.element === 'fire')
    apply('brulure', 1, { value: R.livingFlame.value, duration: R.livingFlame.rounds });
  if (hasUnique(hero, UNIQUE.frostTracking) && basic) apply('froid', 1);
  if (
    hasUnique(hero, UNIQUE.corrosiveVials) &&
    (activeAlteration(target, 'corrosion')?.stacks ?? 0) < R.corrosiveVials.maxStacks
  )
    apply('corrosion', R.corrosiveVials.chance, { value: R.corrosiveVials.value });

  if (!result.critical) return;
  if (hasUnique(hero, UNIQUE.incendiaryTips))
    apply('brulure', 1, {
      damagePerStack: result.amount * R.incendiaryTips.share,
      duration: R.incendiaryTips.rounds,
    });
  if (hasUnique(hero, UNIQUE.spectralArrows)) {
    const other = randomEnemy(ctx, [target]);
    if (other && oncePerRound(ctx, hero, 'spectralRound')) {
      announce(ctx, hero, UNIQUE.spectralArrows);
      directDamage(hero, other, result.amount * R.spectralArrows.share, events);
    }
  }
}

/**
 * Fin d'une attaque du porteur : Conduction (rebond), Pluie de flèches (2 flèches en plus),
 * puis Moisson funeste si un ennemi est tombé pendant l'action. `strike` frappe une autre cible
 * à une part des dégâts (avec les effets « au contact »).
 */
export function uniquesAfterAttack(
  ctx: Ctx,
  hero: Combatant,
  skill: CatalogSkill,
  hit: { targets: readonly Combatant[]; aliveBefore: readonly Combatant[] },
  strike: (target: Combatant, share: number) => AttackResult,
): void {
  const { data, state, events } = ctx;
  const rng = state.rng;
  if (!alive(hero)) return;
  if (hasUnique(hero, UNIQUE.conduction) && chance(rng, R.conduction.chance)) {
    const other = randomEnemy(ctx, hit.targets);
    if (other) {
      announce(ctx, hero, UNIQUE.conduction);
      strike(other, R.conduction.share);
    }
  }
  if (
    hasUnique(hero, UNIQUE.arrowRain) &&
    (skill.cooldown ?? 0) === 0 &&
    state.monsters.some(alive) &&
    chance(rng, R.arrowRain.chance) &&
    oncePerRound(ctx, hero, 'arrowRainRound')
  ) {
    announce(ctx, hero, UNIQUE.arrowRain);
    const shot: Combatant[] = [...hit.targets];
    for (let i = 0; i < R.arrowRain.arrows; i++) {
      // Des cibles différentes : d'autres ennemis d'abord, la cible principale s'il n'y en a plus.
      const target = randomEnemy(ctx, shot) ?? randomEnemy(ctx);
      if (!target) break;
      shot.push(target);
      strike(target, R.arrowRain.share);
    }
  }
  if (
    hasUnique(hero, UNIQUE.grimHarvest) &&
    hit.aliveBefore.some((m) => !alive(m)) &&
    oncePerRound(ctx, hero, 'harvestRound')
  ) {
    announce(ctx, hero, UNIQUE.grimHarvest);
    heal(hero, hero, hero.stats.maxHp * R.grimHarvest.heal, events);
    for (const m of state.monsters.filter(alive))
      tryApplyAlteration(data, rng, hero, m, 'corruption', 1, events);
  }
}

// ---------------------------------------------------------------------------
// Coups reçus par le porteur
// ---------------------------------------------------------------------------

/** Un monstre a touché le porteur : Peau de granit, Manteau de givre, Racines protectrices. */
export function uniquesWhenHit(ctx: Ctx, monster: Combatant, hero: Combatant, damage: number) {
  const { data, state, events } = ctx;
  if (!alive(hero)) return;
  if (hasUnique(hero, UNIQUE.graniteSkin)) {
    hero.counters.graniteHits = (hero.counters.graniteHits ?? 0) + 1;
    if (hero.counters.graniteHits >= R.graniteSkin.hitsNeeded) {
      hero.counters.graniteHits = 0;
      announce(ctx, hero, UNIQUE.graniteSkin);
      addModifier(
        hero,
        hero,
        key(UNIQUE.graniteSkin),
        null,
        'buff',
        { duration: R.graniteSkin.rounds, stats: { armor: R.graniteSkin.armor } },
        events,
      );
    }
  }
  if (
    hasUnique(hero, UNIQUE.frostMantle) &&
    monster.attackType !== 'magical' &&
    alive(monster) &&
    chance(state.rng, R.frostMantle.chance)
  ) {
    announce(ctx, hero, UNIQUE.frostMantle);
    tryApplyAlteration(data, state.rng, hero, monster, 'froid', 1, events);
  }
  if (hasUnique(hero, UNIQUE.protectiveRoots)) {
    const room = hero.stats.maxHp * R.protectiveRoots.cap - hero.shield;
    const amount = Math.min(room, damage * R.protectiveRoots.share);
    if (amount >= 1) addShield(hero, amount, R.protectiveRoots.rounds, events);
  }
}

/** Un monstre a raté le porteur : Brume protectrice (+5 % d'Esquive, 3 piles). */
export function uniquesWhenDodged(ctx: Ctx, hero: Combatant): void {
  if (!alive(hero) || !hasUnique(hero, UNIQUE.protectiveMist)) return;
  addModifier(
    hero,
    hero,
    key(UNIQUE.protectiveMist),
    null,
    'buff',
    {
      duration: R.protectiveMist.rounds,
      dodge: R.protectiveMist.dodge,
      maxStacks: R.protectiveMist.maxStacks,
    },
    ctx.events,
  );
}

/**
 * Avant de compter les morts (après chaque action et en fin de manche) : Dernier souffle (un coup
 * mortel laisse à 1 PV, 1 fois par combat) puis Dernier rempart (sous 30 % des PV : bouclier et
 * purification, 1 fois par combat).
 */
export function uniquesBeforeDeaths(ctx: Ctx): void {
  const { events } = ctx;
  for (const hero of ctx.state.heroes) {
    if (hero.dead) continue;
    if (hero.hp <= 0 && hasUnique(hero, UNIQUE.lastBreath) && !hero.counters.lastBreathUsed) {
      hero.counters.lastBreathUsed = 1;
      hero.hp = 1;
      announce(ctx, hero, UNIQUE.lastBreath);
      events.push({ type: 'revive', targetId: hero.id, amount: 1, itemId: UNIQUE.lastBreath });
      addModifier(
        hero,
        hero,
        key(UNIQUE.lastBreath),
        null,
        'buff',
        { duration: R.lastBreath.rounds, dodge: R.lastBreath.dodge },
        events,
      );
    }
    if (
      alive(hero) &&
      hasUnique(hero, UNIQUE.lastBastion) &&
      !hero.counters.lastBastionUsed &&
      hero.hp / hero.stats.maxHp < R.lastBastion.below
    ) {
      hero.counters.lastBastionUsed = 1;
      announce(ctx, hero, UNIQUE.lastBastion);
      addShield(hero, hero.stats.maxHp * R.lastBastion.shield, R.lastBastion.rounds, events);
      cleanse(hero, 1, events);
    }
  }
}
