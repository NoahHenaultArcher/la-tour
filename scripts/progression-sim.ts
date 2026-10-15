/**
 * Simulation de progression : une équipe de 3 héros (Guerrier, Mage, Tireur, niveau 1) monte la tour
 * depuis l'étage 1, en solo et en mode auto. Compare plusieurs gains d'XP (XP_GAIN.multiplier).
 *
 * Usage : pnpm --filter @la-tour/scripts progression-sim
 *
 * Comportement simulé du joueur :
 * - il tente l'étage courant ; victoire → étage suivant ;
 * - défaite → l'XP gagnée est gardée, il va chasser dans la meilleure zone débloquée jusqu'à gagner
 *   un niveau (s'il y meurt, il redescend d'une zone), puis retente l'étage ;
 * - avant l'étage 5 (aucune zone de chasse), il retente simplement l'étage.
 * Hypothèses : équipement du palier de l'étage, amélioré au niveau de l'étage (« attendu » = rareté
 * médiane des boss du biome, ou « Commun ») ; points de stats moitié Vitalité, moitié attaque ;
 * ni Tour d'amélioration, ni héritage, ni fusion.
 * Temps réel : rythme d'affichage du client (CombatPage : 420 ms par événement, 250 ms avant chaque
 * tour auto, divisés par la vitesse) + quelques secondes de navigation par combat lancé.
 * Ne modifie aucun réglage : écrit seulement progression-sim.md.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOCATABLE_STATS,
  RARITY_IDS,
  SLOT_IDS,
  STAT_POINTS,
  XP_GAIN,
  addXp,
  combatRewards,
  createCombat,
  floorType,
  itemStats,
  playAutoTurn,
  starterDeckFor,
  unlockedHuntingZones,
  type ClassId,
  type CombatState,
  type HeroSetup,
  type RarityId,
  type StatAllocation,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

const MULTIPLIERS = [1.5, 3];
const GEAR: ('expected' | 'common')[] = ['expected', 'common'];
const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];
const MAX_ROUNDS = 150;
/** Sessions de chasse maximum par étage avant de déclarer l'équipe bloquée. */
const MAX_HUNTS_PER_FLOOR = 60;
const EVENT_MS = 420;
const AUTO_TURN_MS = 250;
/** Navigation, lancement du combat, écran de fin. */
const OVERHEAD_PER_COMBAT_S = 5;

const ATTACK_STAT: Record<ClassId, 'strength' | 'magic'> = {
  warrior: 'strength',
  mage: 'magic',
  ranger: 'strength',
};
/** Deck complet de shared/src/combat/simulation.test.ts (actives 0-2, passives 3-4). */
const FULL_DECKS: Record<ClassId, string[]> = {
  warrior: ['GUE-A01-NEU', 'GUE-A04-NEU', 'GUE-A07-NEU', 'GUE-P02', 'GUE-P04'],
  mage: ['MAG-A01-NEU', 'MAG-A03-NEU', 'MAG-A07-NEU', 'MAG-P01', 'MAG-P02'],
  ranger: ['TIR-A02-NEU', 'TIR-A03-NEU', 'TIR-A07-NEU', 'TIR-P01', 'TIR-P07'],
};

const baseOf = (id: string) =>
  gameData.skills.bases.find(
    (b) => b.id === gameData.skills.catalog.find((s) => s.id === id)!.baseId,
  )!;

/** Meilleur deck disponible au niveau : deck complet, complété par le kit de départ. */
function deckFor(classId: ClassId, level: number): HeroSetup['deck'] {
  const deck: HeroSetup['deck'] = [];
  const used = new Set<string>();
  FULL_DECKS[classId].forEach((id, position) => {
    if (baseOf(id).requiredLevel <= level) {
      deck.push({ position, skillId: id });
      used.add(baseOf(id).id);
    }
  });
  for (const slot of starterDeckFor(gameData, classId)) {
    if (used.has(baseOf(slot.skillId).id)) continue;
    const free =
      slot.position < 3
        ? [0, 1, 2].find((p) => !deck.some((d) => d.position === p))
        : [3, 4].find((p) => !deck.some((d) => d.position === p));
    if (free !== undefined) {
      deck.push({ position: free, skillId: slot.skillId });
      used.add(baseOf(slot.skillId).id);
    }
  }
  return deck;
}

function allocationFor(classId: ClassId, level: number): StatAllocation {
  const points = Math.max(0, level - 1) * STAT_POINTS.perLevel;
  const allocation = Object.fromEntries(ALLOCATABLE_STATS.map((s) => [s, 0])) as StatAllocation;
  allocation.vitality = Math.floor(points / 2);
  allocation[ATTACK_STAT[classId]] = points - allocation.vitality;
  return allocation;
}

const tierOf = (floor: number) =>
  gameData.equipment.tiers.filter((t) => t.unlockFloor <= floor).at(-1)!.tier;
const biomeOf = (floor: number) =>
  gameData.elements.biomes.find((b) => floor >= b.floorMin && floor <= b.floorMax)!;

function expectedRarity(floor: number): RarityId {
  const weights = gameData.loot.rarityTables.boss.find(
    (r) => r.biome === biomeOf(floor).id,
  )!.weights;
  let cumulative = 0;
  for (const rarity of RARITY_IDS) {
    if (rarity === 'unique') continue;
    cumulative += weights[rarity] ?? 0;
    if (cumulative >= 0.5) return rarity;
  }
  return 'common';
}

/** Équipement porté pendant qu'on joue l'étage `floor` (meilleur palier atteint). */
function equipmentFor(classId: ClassId, floor: number, gear: 'expected' | 'common') {
  const tier = tierOf(floor);
  const rarity = gear === 'common' ? 'common' : expectedRarity(floor);
  return SLOT_IDS.map((slot) => {
    const item = gameData.equipment.catalog.find(
      (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
    )!;
    const upgrade = Math.min(Math.max(0, floor - item.baseLevel), item.maxUpgrade);
    return itemStats(gameData.equipment, item, upgrade);
  });
}

interface Hero {
  level: number;
  xp: number;
}

function heroes(team: Hero[], floor: number, gear: 'expected' | 'common'): HeroSetup[] {
  return CLASSES.map((classId, i) => ({
    characterId: `h${i}`,
    classId,
    level: team[i]!.level,
    heritageCount: 0,
    equipment: equipmentFor(classId, floor, gear),
    deck: deckFor(classId, team[i]!.level),
    allocation: allocationFor(classId, team[i]!.level),
  }));
}

/** Durée réelle d'un tour auto à l'écran, en secondes, à la vitesse ×1. */
const turnSeconds = (events: number) => (events * EVENT_MS + AUTO_TURN_MS) / 1000;

function applyXp(team: Hero[], state: CombatState): Hero[] {
  const { xp } = combatRewards(gameData.monsters, state);
  return team.map((hero, i) => {
    const { level, xp: rest } = addXp(gameData.monsters, hero, xp[`h${i}`] ?? 0);
    return { level, xp: rest };
  });
}

/** Un étage de la tour, joué jusqu'au bout. */
function playFloor(team: Hero[], floor: number, gear: 'expected' | 'common', seed: number) {
  let { state } = createCombat(gameData, {
    floor,
    heroes: heroes(team, floor, gear),
    tower: {},
    seed,
  });
  let seconds = OVERHEAD_PER_COMBAT_S;
  while (state.phase === 'heroes' && state.round <= MAX_ROUNDS) {
    const result = playAutoTurn(gameData, state);
    seconds += turnSeconds(result.events.length);
    state = result.state;
  }
  return { team: applyXp(team, state), won: state.phase === 'victory', seconds };
}

/** Une session de chasse : jusqu'à gagner un niveau, ou jusqu'à la mort de l'équipe. */
function hunt(
  team: Hero[],
  zoneFloor: number,
  floor: number,
  gear: 'expected' | 'common',
  seed: number,
) {
  const startLevel = team[0]!.level;
  let { state } = createCombat(gameData, {
    floor: zoneFloor,
    mode: 'hunt',
    heroes: heroes(team, floor, gear),
    tower: {},
    seed,
  });
  let seconds = OVERHEAD_PER_COMBAT_S;
  let after = team;
  while (state.phase === 'heroes' && state.round <= 2000) {
    const result = playAutoTurn(gameData, state);
    seconds += turnSeconds(result.events.length);
    state = result.state;
    after = applyXp(team, state);
    if (after[0]!.level > startLevel) break;
  }
  return { team: after, died: state.phase === 'defeat', seconds };
}

interface FloorLog {
  floor: number;
  /** Niveau de l'équipe quand l'étage est validé. */
  level: number;
  attempts: number;
  hunts: number;
  /** Temps cumulé depuis le début, en secondes (vitesse ×1). */
  total: number;
}

function climb(multiplier: number, gear: 'expected' | 'common') {
  (XP_GAIN as { multiplier: number }).multiplier = multiplier;
  let team: Hero[] = CLASSES.map(() => ({ level: 1, xp: 0 }));
  let total = 0;
  let huntSeconds = 0;
  const log: FloorLog[] = [];
  for (let floor = 1; floor <= 100; floor++) {
    let attempts = 0;
    let hunts = 0;
    let won = false;
    let zoneDrop = 0;
    while (!won && hunts <= MAX_HUNTS_PER_FLOOR) {
      attempts++;
      const run = playFloor(team, floor, gear, floor * 7919 + attempts);
      team = run.team;
      total += run.seconds;
      won = run.won;
      if (won) break;
      const zones = unlockedHuntingZones(gameData.zones, floor - 1);
      if (zones.length === 0) continue;
      // Chasse jusqu'au niveau suivant ; en cas de mort, une zone plus basse.
      const startLevel = team[0]!.level;
      while (team[0]!.level === startLevel && hunts <= MAX_HUNTS_PER_FLOOR) {
        hunts++;
        const zone = zones[Math.max(0, zones.length - 1 - zoneDrop)]!;
        const session = hunt(team, zone.floor, floor - 1, gear, floor * 104729 + hunts);
        team = session.team;
        total += session.seconds;
        huntSeconds += session.seconds;
        if (session.died) zoneDrop++;
      }
    }
    log.push({ floor, level: team[0]!.level, attempts, hunts, total });
    if (!won) return { log, stuckAt: floor, total, huntSeconds };
  }
  return { log, stuckAt: null, total, huntSeconds };
}

const started = Date.now();
const results = MULTIPLIERS.flatMap((multiplier) =>
  GEAR.map((gear) => {
    const result = climb(multiplier, gear);
    process.stdout.write(`XP ×${multiplier}, équipement ${gear} : terminé\n`);
    return { multiplier, gear, ...result };
  }),
);
process.stdout.write(`Terminé en ${Math.round((Date.now() - started) / 1000)} s\n`);

/** Durée lisible ; `speed` divise la part « affichage » (l'overhead de navigation est fixe). */
function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
/** Temps à la vitesse ×3 : tout sauf l'overhead de navigation est divisé par 3. */
const atSpeed3 = (seconds: number, combats: number) =>
  (seconds - combats * OVERHEAD_PER_COMBAT_S) / 3 + combats * OVERHEAD_PER_COMBAT_S;
const combatsOf = (log: FloorLog[], upTo: number) =>
  log.filter((l) => l.floor <= upTo).reduce((n, l) => n + l.attempts + l.hunts, 0);

const label = (r: (typeof results)[number]) =>
  `XP ×${r.multiplier} · ${r.gear === 'expected' ? 'équipement attendu' : 'équipement Commun'}`;
const checkpoints = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const lines = [
  '# Simulation de progression : 3 héros dès l’étage 1 (mode auto, solo)',
  '',
  'Temps cumulé pour valider chaque étage (vitesse ×1 / ×3) et niveau de l’équipe à ce moment.',
  '',
  `| Étage | ${results.map(label).join(' | ')} |`,
  `|---|${results.map(() => '---').join('|')}|`,
  ...checkpoints.map((floor) => {
    const cells = results.map((r) => {
      const step = r.log.find((l) => l.floor === floor);
      if (!step || (r.stuckAt !== null && floor >= r.stuckAt)) return 'bloqué';
      const n = combatsOf(r.log, floor);
      return `${duration(step.total)} / ${duration(atSpeed3(step.total, n))} · niv. ${step.level}`;
    });
    return `| ${floor} | ${cells.join(' | ')} |`;
  }),
  '',
  '## Résumé',
  '',
  ...results.map((r) => {
    const combats = combatsOf(r.log, 100);
    const hunts = r.log.reduce((n, l) => n + l.hunts, 0);
    const retries = r.log.reduce((n, l) => n + l.attempts - 1, 0);
    return `- **${label(r)}** : ${r.stuckAt ? `bloqué à l’étage ${r.stuckAt}` : 'tour terminée'} en ${duration(r.total)} (×1) / ${duration(atSpeed3(r.total, combats))} (×3) ; ${retries} étages ratés, ${hunts} sessions de chasse (${Math.round((100 * r.huntSeconds) / r.total)} % du temps).`;
  }),
  '',
  '## Détail par étage (niveau · tentatives · sessions de chasse)',
  '',
  `| Étage | Type | ${results.map(label).join(' | ')} |`,
  `|---|---|${results.map(() => '---').join('|')}|`,
  ...Array.from({ length: 100 }, (_, i) => {
    const floor = i + 1;
    const cells = results.map((r) => {
      const step = r.log.find((l) => l.floor === floor);
      return step ? `${step.level} · ${step.attempts} · ${step.hunts}` : '—';
    });
    return `| ${floor} | ${floorType(floor)} | ${cells.join(' | ')} |`;
  }),
];
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(here, 'progression-sim.md'), lines.join('\n') + '\n');
console.log('Écrit : scripts/progression-sim.md');
