/**
 * Moteur de combat au tour par tour (pur et déterministe : même état + même action = même résultat).
 *
 * Une manche :
 *  1. le camp à la plus haute Initiative moyenne (vivants) joue en entier, puis l'autre ; égalité → héros ;
 *  2. héros : 3 actions par manche pour toute l'équipe (solo), réparties librement ;
 *  3. monstres : chacun agit selon son rôle, par Initiative décroissante ;
 *  4. fin de manche : altérations (dégâts, expiration), recharges −1.
 * Les PV des héros sont conservés entre les vagues. Le serveur appelle ces fonctions ;
 * le client n'envoie que des intentions.
 */
import { COMBAT_RULES } from '../balance.ts';
import { createRng, pick, type Rng } from '../rules/random.ts';
import { floorType, zoneFloorOf } from '../rules/tower.ts';
import type { UpgradeTowerLevels } from '../rules/village.ts';
import { resolveTurnStart, tickAlterations, tryApplyAlteration } from './alterations.ts';
import { attack, type AttackSpec } from './damage.ts';
import {
  buildFloorWaves,
  buildHuntWave,
  createHeroCombatant,
  createMonsterCombatant,
  type HeroSetup,
} from './setup.ts';
import { resolveAttack, skillById } from './skills.ts';
import type {
  CombatData,
  CombatEvent,
  CombatMode,
  CombatState,
  Combatant,
  HeroActionInput,
  Side,
} from './types.ts';

export class CombatError extends Error {
  constructor(
    readonly code:
      | 'NOT_YOUR_TURN'
      | 'INVALID_HERO'
      | 'INVALID_SKILL'
      | 'SKILL_ON_COOLDOWN'
      | 'INVALID_TARGET'
      | 'COMBAT_OVER'
      | 'NOT_A_HUNT',
  ) {
    super(code);
    this.name = 'CombatError';
  }
}

export interface CombatSetup {
  /** Étage de la tour, ou étage de la zone pour une chasse. */
  floor: number;
  /** Tour (étage normal, boss, dragon) ou zone de chasse (vagues sans fin). Par défaut : tour. */
  mode?: CombatMode;
  heroes: HeroSetup[];
  tower: UpgradeTowerLevels;
  seed: number;
}

export interface CombatResult {
  state: CombatState;
  events: CombatEvent[];
}

interface Ctx {
  data: CombatData;
  state: CombatState;
  events: CombatEvent[];
}

const alive = (c: Combatant) => c.hp > 0;
const canAct = (c: Combatant) => c.hp > 0 && !c.stunnedThisPhase;
const average = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export function createCombat(data: CombatData, setup: CombatSetup): CombatResult {
  if (setup.heroes.length === 0 || setup.heroes.length > 3)
    throw new Error('1 à 3 héros par combat');
  const rng = createRng(setup.seed);
  const mode = setup.mode ?? 'tower';
  const state: CombatState = {
    version: 1,
    mode,
    floor: setup.floor,
    floorType: mode === 'hunt' ? 'normal' : floorType(setup.floor),
    zoneFloor: mode === 'hunt' ? setup.floor : zoneFloorOf(setup.floor),
    actionsPerRound: data.skills.params.soloActionsPerRound,
    waves:
      mode === 'hunt'
        ? [buildHuntWave(data, setup.floor, rng)]
        : buildFloorWaves(data, setup.floor, rng),
    waveIndex: 0,
    round: 0,
    phase: 'heroes',
    actionsLeft: 0,
    monstersPending: false,
    firstSide: 'hero',
    heroInitiative: 0,
    monsterInitiative: 0,
    heroes: setup.heroes.map((hero, i) => createHeroCombatant(data, hero, i, setup.tower)),
    monsters: [],
    killed: [],
    rng,
    spawned: 0,
  };
  const ctx: Ctx = { data, state, events: [] };
  spawnWave(ctx);
  startRound(ctx);
  return { state, events: ctx.events };
}

/** Action d'un héros pendant le tour des héros. */
export function performHeroAction(
  data: CombatData,
  current: CombatState,
  input: HeroActionInput,
): CombatResult {
  const ctx = begin(data, current);
  heroAction(ctx, input);
  return { state: ctx.state, events: ctx.events };
}

/** Le joueur passe les actions restantes du tour des héros. */
export function endHeroTurn(data: CombatData, current: CombatState): CombatResult {
  const ctx = begin(data, current);
  finishHeroPhase(ctx);
  return { state: ctx.state, events: ctx.events };
}

/** Mode auto : l'IA joue les actions restantes de ce tour des héros. */
export function playAutoTurn(data: CombatData, current: CombatState): CombatResult {
  const ctx = begin(data, current);
  const round = ctx.state.round;
  const wave = ctx.state.waveIndex;
  while (
    ctx.state.phase === 'heroes' &&
    ctx.state.round === round &&
    ctx.state.waveIndex === wave
  ) {
    const action = chooseAutoAction(data, ctx.state);
    if (!action) {
      finishHeroPhase(ctx);
      break;
    }
    heroAction(ctx, action);
  }
  return { state: ctx.state, events: ctx.events };
}

/** Abandon : défaite immédiate (XP et or des monstres déjà vaincus conservés). */
export function forfeitCombat(data: CombatData, current: CombatState): CombatResult {
  const ctx = begin(data, current);
  end(ctx, 'defeat');
  return { state: ctx.state, events: ctx.events };
}

/** Zone de chasse : le joueur s'arrête quand il veut et garde tout ce qu'il a gagné. */
export function retreatFromHunt(data: CombatData, current: CombatState): CombatResult {
  const ctx = begin(data, current);
  if (ctx.state.mode !== 'hunt') throw new CombatError('NOT_A_HUNT');
  end(ctx, 'retreat');
  return { state: ctx.state, events: ctx.events };
}

/** Debug : tous les monstres de la vague en cours sont vaincus. */
export function winCurrentWave(data: CombatData, current: CombatState): CombatResult {
  const ctx = begin(data, current);
  for (const m of ctx.state.monsters) {
    if (alive(m)) {
      m.hp = 0;
      ctx.events.push({ type: 'death', targetId: m.id });
    }
  }
  settle(ctx);
  return { state: ctx.state, events: ctx.events };
}

/**
 * Choix de l'IA : un héros capable d'agir (à tour de rôle), la compétence prête la plus forte
 * (une attaque de zone compte pour chaque cible), sur le monstre le plus affaibli.
 */
export function chooseAutoAction(data: CombatData, state: CombatState): HeroActionInput | null {
  if (state.phase !== 'heroes' || state.actionsLeft <= 0) return null;
  const heroes = state.heroes.filter(canAct);
  const targets = state.monsters.filter(alive);
  if (heroes.length === 0 || targets.length === 0) return null;
  const used = state.actionsPerRound - state.actionsLeft;
  const hero = heroes[used % heroes.length]!;

  let best: { skillId: string; score: number } | null = null;
  for (const slot of hero.skills) {
    if (slot.remaining > 0) continue;
    const skill = skillById(data, slot.skillId);
    if (skill.kind !== 'attack') continue;
    const attackInfo = resolveAttack(data, slot.skillId);
    const score =
      attackInfo.power * (attackInfo.area ? targets.length : 1) * (1 + attackInfo.bonusCrit);
    if (!best || score > best.score) best = { skillId: slot.skillId, score };
  }
  if (!best) return null;
  const weakest = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
  return { heroId: hero.id, skillId: best.skillId, targetId: weakest.id };
}

// ---------------------------------------------------------------------------
// Déroulement
// ---------------------------------------------------------------------------

function begin(data: CombatData, current: CombatState): Ctx {
  if (current.phase !== 'heroes') throw new CombatError('COMBAT_OVER');
  return { data, state: structuredClone(current), events: [] };
}

function spawnWave(ctx: Ctx): void {
  const { state, data } = ctx;
  const wave = state.waves[state.waveIndex]!;
  state.monsters = wave.map((spawn) => createMonsterCombatant(data, spawn, `m${state.spawned++}`));
  ctx.events.push({ type: 'wave', wave: state.waveIndex + 1, total: state.waves.length });
}

function startRound(ctx: Ctx): void {
  const { state } = ctx;
  state.round += 1;
  state.heroInitiative = average(state.heroes.filter(alive).map((h) => h.stats.initiative));
  state.monsterInitiative = average(state.monsters.filter(alive).map((m) => m.stats.initiative));
  const first: Side = state.heroInitiative >= state.monsterInitiative ? 'hero' : 'monster';
  state.firstSide = first;
  ctx.events.push({
    type: 'round',
    round: state.round,
    first,
    heroInitiative: Math.round(state.heroInitiative),
    monsterInitiative: Math.round(state.monsterInitiative),
  });
  state.monstersPending = first === 'hero';
  if (first === 'monster') {
    monsterPhase(ctx);
    if (state.phase !== 'heroes') return;
  }
  beginHeroPhase(ctx);
}

function beginHeroPhase(ctx: Ctx): void {
  const { state, data } = ctx;
  for (const hero of state.heroes) resolveTurnStart(data, state.rng, hero, ctx.events);
  state.actionsLeft = state.actionsPerRound;
  if (!state.heroes.some(canAct)) finishHeroPhase(ctx);
}

function finishHeroPhase(ctx: Ctx): void {
  const { state } = ctx;
  if (state.phase !== 'heroes') return;
  state.actionsLeft = 0;
  for (const hero of state.heroes) hero.stunnedThisPhase = false;
  if (state.monstersPending) {
    monsterPhase(ctx);
    if (state.phase !== 'heroes') return;
  }
  endRound(ctx);
}

function heroAction(ctx: Ctx, input: HeroActionInput): void {
  const { state, data, events } = ctx;
  if (state.actionsLeft <= 0) throw new CombatError('NOT_YOUR_TURN');
  const hero = state.heroes.find((h) => h.id === input.heroId);
  if (!hero || !canAct(hero)) throw new CombatError('INVALID_HERO');
  const slot = hero.skills.find((s) => s.skillId === input.skillId);
  if (!slot) throw new CombatError('INVALID_SKILL');
  if (slot.remaining > 0) throw new CombatError('SKILL_ON_COOLDOWN');
  const skill = skillById(data, slot.skillId);
  // Phase 4 : seules les attaques sont jouables (les autres arrivent avec les decks, phase 7).
  if (skill.kind !== 'attack') throw new CombatError('INVALID_SKILL');

  const attackInfo = resolveAttack(data, slot.skillId);
  const living = state.monsters.filter(alive);
  let targets: Combatant[];
  if (attackInfo.area) {
    targets = living;
  } else {
    const target = living.find((m) => m.id === input.targetId);
    if (!target) throw new CombatError('INVALID_TARGET');
    targets = [target];
  }

  events.push({
    type: 'action',
    actorId: hero.id,
    skillId: slot.skillId,
    targetIds: targets.map((t) => t.id),
  });
  const spec: AttackSpec = {
    power: attackInfo.power,
    element: attackInfo.element,
    elementalShare: attackInfo.element === 'neutral' ? 0 : 1,
    armorIgnore: attackInfo.armorIgnore,
    resistanceIgnore: attackInfo.resistanceIgnore,
    neverMiss: attackInfo.neverMiss,
    bonusCrit: attackInfo.bonusCrit,
  };
  for (const target of targets) attack(data, state.rng, hero, target, spec, events);
  slot.remaining = slot.cooldown;
  state.actionsLeft -= 1;

  if (settle(ctx)) return;
  if (state.actionsLeft <= 0 || !state.heroes.some(canAct)) finishHeroPhase(ctx);
}

function monsterPhase(ctx: Ctx): void {
  const { state, data } = ctx;
  state.monstersPending = false;
  for (const m of state.monsters) resolveTurnStart(data, state.rng, m, ctx.events);
  const order = state.monsters
    .map((m, index) => ({ m, index }))
    .sort((a, b) => b.m.stats.initiative - a.m.stats.initiative || a.index - b.index)
    .map(({ m }) => m);
  for (const monster of order) {
    if (!canAct(monster) || !state.heroes.some(alive)) continue;
    monsterAct(ctx, monster);
    if (settle(ctx)) return;
  }
  for (const m of state.monsters) m.stunnedThisPhase = false;
}

function monsterAct(ctx: Ctx, monster: Combatant): void {
  const { state, data, events } = ctx;
  const rng = state.rng;
  const heroes = state.heroes.filter(alive);

  // Soutien : soigne l'allié le plus blessé s'il passe sous le seuil.
  if (monster.role === 'support') {
    const wounded = state.monsters
      .filter((m) => alive(m) && m.hp / m.stats.maxHp < COMBAT_RULES.supportHealThreshold)
      .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
    if (wounded) {
      const amount = Math.max(1, Math.round(wounded.stats.maxHp * COMBAT_RULES.supportHealShare));
      wounded.hp = Math.min(wounded.stats.maxHp, wounded.hp + amount);
      events.push({ type: 'action', actorId: monster.id, skillId: null, targetIds: [wounded.id] });
      events.push({ type: 'heal', sourceId: monster.id, targetId: wounded.id, amount });
      return;
    }
  }

  // Dragon : souffle sur toute l'équipe une manche sur trois.
  const breath = monster.role === 'dragon' && state.round % COMBAT_RULES.dragonBreathEvery === 0;
  const targets = breath ? heroes : [chooseMonsterTarget(monster, heroes, rng)];
  events.push({
    type: 'action',
    actorId: monster.id,
    skillId: null,
    targetIds: targets.map((t) => t.id),
  });
  const spec: AttackSpec = {
    power: data.monsters.params.combat.monsterAveragePower,
    element: monster.element,
    elementalShare: monster.stats.elementalShare,
    armorIgnore: 0,
    resistanceIgnore: 0,
    neverMiss: false,
    bonusCrit: 0,
  };
  for (const target of targets) {
    const damage = attack(data, rng, monster, target, spec, events);
    if (damage > 0) {
      for (const alteration of monster.inflicts) {
        tryApplyAlteration(data, rng, monster, target, alteration.id, alteration.chance, events);
      }
    }
  }
}

/** Assassins et tireurs visent le héros le plus faible ; les autres frappent au hasard. */
function chooseMonsterTarget(monster: Combatant, heroes: Combatant[], rng: Rng): Combatant {
  if (monster.role === 'assassin' || monster.role === 'ranger') {
    return heroes.reduce((a, b) => (b.hp < a.hp ? b : a));
  }
  return pick(rng, heroes);
}

function endRound(ctx: Ctx): void {
  const { state } = ctx;
  for (const c of [...state.heroes, ...state.monsters]) tickAlterations(c, ctx.events);
  for (const hero of state.heroes) {
    for (const slot of hero.skills) slot.remaining = Math.max(0, slot.remaining - 1);
  }
  if (settle(ctx, false)) return;
  startRound(ctx);
}

/**
 * Prend en compte les morts : récompenses, défaite, vague suivante ou victoire.
 * Renvoie true si le déroulement normal s'arrête (fin de combat ou nouvelle vague lancée).
 */
function settle(ctx: Ctx, endRoundOnWaveClear = true): boolean {
  const { state, events } = ctx;
  for (const m of state.monsters) {
    if (m.hp <= 0 && !m.dead) {
      m.dead = true;
      if (!events.some((e) => e.type === 'death' && e.targetId === m.id))
        events.push({ type: 'death', targetId: m.id });
      if (m.reward) state.killed.push({ monsterId: m.refId, level: m.level, ...m.reward });
    }
  }
  for (const h of state.heroes) {
    if (h.hp <= 0 && !h.dead) {
      h.dead = true;
      if (!events.some((e) => e.type === 'death' && e.targetId === h.id))
        events.push({ type: 'death', targetId: h.id });
    }
  }
  if (!state.heroes.some(alive)) {
    end(ctx, 'defeat');
    return true;
  }
  if (state.monsters.some(alive)) return false;

  // Vague terminée. En zone de chasse, une nouvelle vague arrive sans fin.
  if (state.waveIndex + 1 >= state.waves.length) {
    if (state.mode !== 'hunt') {
      end(ctx, 'victory');
      return true;
    }
    state.waves.push(buildHuntWave(ctx.data, state.zoneFloor, state.rng));
  }
  if (endRoundOnWaveClear) {
    // La manche se termine (altérations, recharges) avant la vague suivante.
    for (const c of state.heroes) tickAlterations(c, events);
    for (const hero of state.heroes) {
      for (const slot of hero.skills) slot.remaining = Math.max(0, slot.remaining - 1);
    }
    if (!state.heroes.some(alive)) {
      settle(ctx);
      return true;
    }
  }
  state.waveIndex += 1;
  spawnWave(ctx);
  startRound(ctx);
  return true;
}

function end(ctx: Ctx, outcome: 'victory' | 'defeat' | 'retreat'): void {
  ctx.state.phase = outcome;
  ctx.state.actionsLeft = 0;
  ctx.events.push({ type: 'end', outcome });
}
