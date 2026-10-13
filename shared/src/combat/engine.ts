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
import { afterHeroHit, beforeMonsterAttack, heroEndOfRound, useHeroSkill } from './actions.ts';
import { resolveTurnStart, tickAlterations, tryApplyAlteration } from './alterations.ts';
import { attack, type AttackSpec } from './damage.ts';
import { SUPPORT_EFFECTS } from './effects.ts';
import { tickModifiers } from './modifiers.ts';
import {
  buildFloorWaves,
  buildHuntWave,
  createHeroCombatant,
  createMonsterCombatant,
  type HeroSetup,
} from './setup.ts';
import { attackEffectOf, dealsDamage, skillById } from './skills.ts';
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
  /** Niveau de la Tour d'alchimie (fusions : altérations prolongées au niveau 3). */
  alchemyLevel?: number;
  /** Multijoueur : 3 actions par héros (chaque joueur joue le sien) au lieu de 3 pour l'équipe. */
  multiplayer?: boolean;
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
    actionsPerRound: setup.multiplayer
      ? data.skills.params.multiActionsPerRound
      : data.skills.params.soloActionsPerRound,
    heroActions: setup.multiplayer ? {} : null,
    alchemyLevel: setup.alchemyLevel ?? 0,
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
    heroes: setup.heroes.map((hero, i) =>
      createHeroCombatant(data, hero, i, hero.tower ?? setup.tower),
    ),
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

/** Multijoueur : un joueur passe les actions restantes de son héros. */
export function passHeroActions(
  data: CombatData,
  current: CombatState,
  heroId: string,
): CombatResult {
  const ctx = begin(data, current);
  const { state } = ctx;
  if (!state.heroActions || !state.heroes.some((h) => h.id === heroId))
    throw new CombatError('INVALID_HERO');
  state.heroActions[heroId] = 0;
  syncActions(state);
  if (state.actionsLeft <= 0) finishHeroPhase(ctx);
  return { state: ctx.state, events: ctx.events };
}

/**
 * Multijoueur : l'IA joue les actions restantes d'un seul héros (joueur déconnecté).
 * `noCooldownOnly` : seulement les compétences sans recharge (règle des déconnexions).
 */
export function playAutoForHero(
  data: CombatData,
  current: CombatState,
  heroId: string,
  options: { noCooldownOnly?: boolean } = {},
): CombatResult {
  const ctx = begin(data, current);
  const { state } = ctx;
  const round = state.round;
  const wave = state.waveIndex;
  while (
    state.phase === 'heroes' &&
    state.round === round &&
    state.waveIndex === wave &&
    (state.heroActions?.[heroId] ?? 0) > 0
  ) {
    const hero = state.heroes.find((h) => h.id === heroId);
    const action = hero && canAct(hero) ? chooseHeroAction(data, state, hero, options) : null;
    if (!action) {
      state.heroActions![heroId] = 0;
      syncActions(state);
      if (state.actionsLeft <= 0) finishHeroPhase(ctx);
      break;
    }
    heroAction(ctx, action);
  }
  return { state: ctx.state, events: ctx.events };
}

/**
 * Zone de chasse en multijoueur : un joueur retire son héros (il garde ses gains) ;
 * la chasse continue pour les autres, et s'arrête si plus personne ne reste.
 */
export function withdrawHero(data: CombatData, current: CombatState, heroId: string): CombatResult {
  const ctx = begin(data, current);
  const { state } = ctx;
  if (state.mode !== 'hunt') throw new CombatError('NOT_A_HUNT');
  if (!state.heroes.some((h) => h.id === heroId)) throw new CombatError('INVALID_HERO');
  state.heroes = state.heroes.filter((h) => h.id !== heroId);
  if (state.heroActions) delete state.heroActions[heroId];
  if (state.heroes.length === 0) {
    end(ctx, 'retreat');
    return { state, events: ctx.events };
  }
  syncActions(state);
  if (state.actionsLeft <= 0 || !state.heroes.some(canAct)) finishHeroPhase(ctx);
  return { state, events: ctx.events };
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
 * Choix de l'IA, pour un héros capable d'agir (à tour de rôle) :
 *  1. se soigner sous 45 % de PV, se protéger sous 70 % ;
 *  2. poser un bonus ou un malus pas encore actif ;
 *  3. sinon, l'attaque prête la plus forte (une attaque de zone compte pour chaque cible),
 *     sur le monstre le plus affaibli.
 */
export function chooseAutoAction(data: CombatData, state: CombatState): HeroActionInput | null {
  if (state.phase !== 'heroes' || state.actionsLeft <= 0) return null;
  const heroes = state.heroes.filter(canAct);
  if (heroes.length === 0) return null;
  const used = state.actionsPerRound - state.actionsLeft;
  return chooseHeroAction(data, state, heroes[used % heroes.length]!);
}

/** Choix de l'IA pour un héros précis (voir chooseAutoAction). */
export function chooseHeroAction(
  data: CombatData,
  state: CombatState,
  hero: Combatant,
  options: { noCooldownOnly?: boolean } = {},
): HeroActionInput | null {
  const targets = state.monsters.filter(alive);
  if (targets.length === 0) return null;
  const weakest = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
  const power = (c: Combatant) => c.stats.strength + c.stats.magic;
  const strongest = targets.reduce((a, b) => (power(b) > power(a) ? b : a));
  const ready = hero.skills
    .filter((s) => s.remaining === 0 && (!options.noCooldownOnly || s.cooldown === 0))
    .map((slot) => ({ slot, skill: skillById(data, slot.skillId) }));
  const hpShare = hero.hp / hero.stats.maxHp;

  const support = (kinds: string[]) =>
    ready.find(
      ({ skill }) =>
        skill.family === 'support' && kinds.includes(skill.kind) && !dealsDamage(skill),
    );
  const heal = hpShare < 0.45 ? support(['heal']) : undefined;
  if (heal) return { heroId: hero.id, skillId: heal.slot.skillId };
  const shield = hpShare < 0.7 && hero.shield === 0 ? support(['shield']) : undefined;
  if (shield) return { heroId: hero.id, skillId: shield.slot.skillId };
  for (const { slot, skill } of ready) {
    if (skill.family !== 'support' || dealsDamage(skill)) continue;
    const effect = SUPPORT_EFFECTS[skill.baseId];
    if (effect?.buff && !hero.modifiers.some((m) => m.key === skill.baseId))
      return { heroId: hero.id, skillId: slot.skillId };
    if (effect?.targetModifier && !strongest.modifiers.some((m) => m.key === skill.baseId))
      return { heroId: hero.id, skillId: slot.skillId, targetId: strongest.id };
  }

  let best: { skillId: string; score: number } | null = null;
  for (const { slot, skill } of ready) {
    if (!dealsDamage(skill)) continue;
    const effect = attackEffectOf(skill, slot.fusion);
    const area = skill.target === 'area';
    const score =
      skill.power *
        (slot.fusion ? data.skills.params.fusionPowerBonus : 1) *
        (area ? targets.length : 1) *
        (1 + (effect.bonusCrit ?? 0) + (effect.damageBonus ?? 0)) +
      // À puissance égale, les compétences à recharge passent avant celles sans recharge.
      (slot.cooldown > 0 ? 0.01 : 0);
    if (!best || score > best.score) best = { skillId: slot.skillId, score };
  }
  if (!best) return null;
  return { heroId: hero.id, skillId: best.skillId, targetId: weakest.id };
}

// ---------------------------------------------------------------------------
// Déroulement
// ---------------------------------------------------------------------------

function begin(data: CombatData, current: CombatState): Ctx {
  if (current.phase !== 'heroes') throw new CombatError('COMBAT_OVER');
  return { data, state: normalizeCombatState(structuredClone(current)), events: [] };
}

/**
 * Complète un combat enregistré avant la phase 7 (effets temporaires, boucliers à durée,
 * compteurs) pour qu'il reprenne sans erreur. Modifie et renvoie l'état.
 */
export function normalizeCombatState(state: CombatState): CombatState {
  // Les champs ajoutés en phase 7 peuvent manquer dans un état enregistré avant.
  const old = state as Partial<CombatState>;
  old.alchemyLevel ??= 0;
  for (const c of [...state.heroes, ...state.monsters] as Partial<Combatant>[]) {
    c.modifiers ??= [];
    c.counters ??= {};
    c.shieldRemaining ??= (c.shield ?? 0) > 0 ? 2 : 0;
    c.extraSkips ??= 0;
    if (c.stats) c.stats.dodgeBonus ??= 0;
  }
  return state;
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
  if (state.heroActions) {
    // Multijoueur : chaque héros capable d'agir a ses propres actions.
    for (const hero of state.heroes)
      state.heroActions[hero.id] = canAct(hero) ? state.actionsPerRound : 0;
    syncActions(state);
  } else {
    state.actionsLeft = state.actionsPerRound;
  }
  if (!state.heroes.some(canAct) || state.actionsLeft <= 0) finishHeroPhase(ctx);
}

/** Multijoueur : actions restantes de l'équipe = somme de celles des héros encore capables d'agir. */
function syncActions(state: CombatState): void {
  if (!state.heroActions) return;
  for (const hero of state.heroes) if (!canAct(hero)) state.heroActions[hero.id] = 0;
  state.actionsLeft = state.heroes.reduce((sum, h) => sum + (state.heroActions![h.id] ?? 0), 0);
}

function finishHeroPhase(ctx: Ctx): void {
  const { state } = ctx;
  if (state.phase !== 'heroes') return;
  state.actionsLeft = 0;
  if (state.heroActions) for (const id of Object.keys(state.heroActions)) state.heroActions[id] = 0;
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
  if (state.heroActions && (state.heroActions[hero.id] ?? 0) <= 0)
    throw new CombatError('NOT_YOUR_TURN');
  const slot = hero.skills.find((s) => s.skillId === input.skillId);
  if (!slot) throw new CombatError('INVALID_SKILL');
  if (slot.remaining > 0) throw new CombatError('SKILL_ON_COOLDOWN');
  const skill = skillById(data, slot.skillId);
  if (skill.family === 'passive') throw new CombatError('INVALID_SKILL');

  const living = state.monsters.filter(alive);
  const chosen = living.find((m) => m.id === input.targetId) ?? null;
  // Mono-cible : une cible vivante est obligatoire ; zone : la cible désignée devient la principale.
  if (skill.target === 'single' && !chosen) throw new CombatError('INVALID_TARGET');
  const targetIds =
    skill.target === 'area'
      ? living.map((t) => t.id)
      : skill.target === 'self'
        ? [hero.id]
        : [chosen!.id];

  events.push({ type: 'action', actorId: hero.id, skillId: slot.skillId, targetIds });
  slot.remaining = slot.cooldown;
  useHeroSkill(ctx, hero, slot, chosen);
  if (state.heroActions) {
    state.heroActions[hero.id] = (state.heroActions[hero.id] ?? 1) - 1;
    syncActions(state);
  } else {
    state.actionsLeft -= 1;
  }

  if (settle(ctx)) return;
  if (state.actionsLeft <= 0 || !state.heroes.some(canAct)) finishHeroPhase(ctx);
}

function monsterPhase(ctx: Ctx): void {
  const { state, data } = ctx;
  state.monstersPending = false;
  for (const m of state.monsters) resolveTurnStart(data, state.rng, m, ctx.events);
  const order = state.monsters
    .map((m, index) => ({ m, index }))
    .sort(
      (a, b) =>
        Number(playsLast(a.m)) - Number(playsLast(b.m)) ||
        b.m.stats.initiative - a.m.stats.initiative ||
        a.index - b.index,
    )
    .map(({ m }) => m);
  for (const monster of order) {
    if (!canAct(monster) || !state.heroes.some(alive)) continue;
    monsterAct(ctx, monster);
    if (settle(ctx)) return;
  }
  for (const m of state.monsters) m.stunnedThisPhase = false;
}

/** Bourbier : ce monstre joue en dernier dans son camp. */
const playsLast = (c: Combatant) => c.modifiers.some((m) => m.playsLast);

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

  // Lave (fusion Magma) : le monstre se brûle en attaquant.
  beforeMonsterAttack(ctx, monster);
  if (!alive(monster)) return;

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
    if (!alive(monster)) break;
    const { amount } = attack(data, rng, monster, target, spec, events);
    if (amount > 0) {
      for (const alteration of monster.inflicts) {
        tryApplyAlteration(data, rng, monster, target, alteration.id, alteration.chance, events);
      }
      afterHeroHit(ctx, monster, target, amount);
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
  for (const hero of state.heroes) heroEndOfRound(ctx, hero);
  for (const c of [...state.heroes, ...state.monsters]) {
    tickAlterations(c, ctx.events);
    tickModifiers(c, ctx.events);
  }
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
      if (m.reward)
        state.killed.push({
          monsterId: m.refId,
          level: m.level,
          ...m.reward,
          sharedBy: state.heroes.length,
        });
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
    // La manche se termine (passifs, altérations, effets, recharges) avant la vague suivante.
    for (const hero of state.heroes) heroEndOfRound(ctx, hero);
    for (const c of state.heroes) {
      tickAlterations(c, events);
      tickModifiers(c, events);
    }
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
