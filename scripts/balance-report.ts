/**
 * Rapport d'équilibrage : simule les 100 étages en mode auto et mesure le taux de victoire.
 *
 * Usage : pnpm --filter @la-tour/scripts balance-report [essais par cas, 12 par défaut]
 *
 * Hypothèses (documentées dans le rapport) :
 * - héros au niveau de l'étage, points de stats répartis moitié Vitalité, moitié stat d'attaque ;
 * - deck complet de la simulation de shared (compétences neutres débloquées au niveau du héros) ;
 * - 10 objets du palier de l'étage, améliorés jusqu'au niveau de l'étage (plafond du palier),
 *   en deux profils : « Commun » et « attendu » (rareté médiane des boss du biome) ;
 * - ni Tour d'amélioration, ni héritage, ni fusion.
 * Ne modifie aucun réglage : écrit seulement balance-report.md et balance-report.json.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOCATABLE_STATS,
  RARITY_IDS,
  STAT_POINTS,
  SLOT_IDS,
  addXp,
  combatRewards,
  createCombat,
  floorType,
  heroCombatStats,
  levelFactor,
  itemStats,
  playAutoForHero,
  playAutoTurn,
  starterDeckFor,
  type ClassId,
  type CombatState,
  type HeroSetup,
  type RarityId,
  type StatAllocation,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

const RUNS = Number(process.argv[2] ?? 12);
const MAX_ROUNDS = 150;
const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];
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

const skill = (id: string) => gameData.skills.catalog.find((s) => s.id === id)!;
const base = (id: string) => gameData.skills.bases.find((b) => b.id === skill(id).baseId)!;

/** Meilleur deck disponible : le deck complet, complété par le kit de départ tant qu'il manque des compétences. */
function deckFor(classId: ClassId, level: number): HeroSetup['deck'] {
  const starter = starterDeckFor(gameData, classId);
  const deck: HeroSetup['deck'] = [];
  const used = new Set<string>();
  FULL_DECKS[classId].forEach((id, position) => {
    if (base(id).requiredLevel <= level) {
      deck.push({ position, skillId: id });
      used.add(base(id).id);
    }
  });
  for (const slot of starter) {
    const taken = deck.some((d) => d.position === slot.position);
    if (!taken && !used.has(base(slot.skillId).id)) {
      deck.push(slot);
      used.add(base(slot.skillId).id);
    }
  }
  // Actives libres restantes : la 2e attaque de départ va dans le premier emplacement actif vide.
  for (const slot of starter.filter((s) => s.position < 3)) {
    if (used.has(base(slot.skillId).id)) continue;
    const free = [0, 1, 2].find((p) => !deck.some((d) => d.position === p));
    if (free !== undefined) {
      deck.push({ position: free, skillId: slot.skillId });
      used.add(base(slot.skillId).id);
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

function tierOf(floor: number): number {
  let tier = 1;
  for (const t of gameData.equipment.tiers) if (t.unlockFloor <= floor) tier = t.tier;
  return tier;
}

const biomeOf = (floor: number) =>
  gameData.elements.biomes.find((b) => floor >= b.floorMin && floor <= b.floorMax)!;

/** Rareté médiane de la table des boss du biome (hors Unique). */
function expectedRarity(floor: number): RarityId {
  const table = gameData.loot.rarityTables.boss.find((r) => r.biome === biomeOf(floor).id)!;
  let cumulative = 0;
  for (const rarity of RARITY_IDS) {
    if (rarity === 'unique') continue;
    cumulative += table.weights[rarity] ?? 0;
    if (cumulative >= 0.5) return rarity;
  }
  return 'common';
}

function equipmentFor(
  classId: ClassId,
  floor: number,
  rarity: RarityId | null,
): HeroSetup['equipment'] {
  if (rarity === null) return [];
  const tier = tierOf(floor);
  return SLOT_IDS.map((slot) => {
    const item = gameData.equipment.catalog.find(
      (c) => c.classId === classId && c.slot === slot && c.tier === tier && c.rarity === rarity,
    );
    if (!item) throw new Error(`Objet introuvable : ${classId} ${slot} P${tier} ${rarity}`);
    const upgrade = Math.min(Math.max(0, floor - item.baseLevel), item.maxUpgrade);
    return itemStats(gameData.equipment, item, upgrade);
  });
}

interface Team {
  label: string;
  classes: ClassId[];
  multiplayer?: boolean;
}

/** Héros de la simulation ; `rarity` null : sans équipement. */
function heroSetup(
  classId: ClassId,
  i: number,
  floor: number,
  level: number,
  rarity: RarityId | null,
): HeroSetup {
  return {
    characterId: `h${i}`,
    classId,
    level,
    heritageCount: 0,
    equipment: equipmentFor(classId, floor, rarity),
    deck: deckFor(classId, level),
    allocation: allocationFor(classId, level),
  };
}

function fight(team: Team, floor: number, level: number, rarity: RarityId | null, seed: number) {
  let { state } = createCombat(gameData, {
    floor,
    heroes: team.classes.map((classId, i) => heroSetup(classId, i, floor, level, rarity)),
    tower: {},
    seed,
    multiplayer: team.multiplayer,
  });
  while (state.phase === 'heroes' && state.round <= MAX_ROUNDS) {
    if (!team.multiplayer) {
      state = playAutoTurn(gameData, state).state;
      continue;
    }
    // Multijoueur : chaque joueur joue ses 3 actions (l'IA joue pour chacun, comme un joueur absent).
    const heroId = state.heroes.find((h) => (state.heroActions?.[h.id] ?? 0) > 0)?.id;
    if (!heroId) break;
    state = playAutoForHero(gameData, state, heroId).state;
  }
  return state;
}

interface Measure {
  winRate: number;
  rounds: number;
  /** PV restants moyens des héros après une victoire (0 à 1). */
  hpLeft: number;
}

function measure(
  team: Team,
  floor: number,
  level: number,
  rarity: RarityId | null,
  runs = RUNS,
): Measure {
  let wins = 0;
  let rounds = 0;
  let hpLeft = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const state: CombatState = fight(team, floor, level, rarity, floor * 1000 + seed);
    rounds += state.round;
    if (state.phase === 'victory') {
      wins++;
      hpLeft +=
        state.heroes.reduce((sum, h) => sum + h.hp / h.stats.maxHp, 0) / state.heroes.length;
    }
  }
  return { winRate: wins / runs, rounds: rounds / runs, hpLeft: wins ? hpLeft / wins : 0 };
}

/** Plus petit niveau qui gagne au moins la moitié des combats (équipement attendu), par dichotomie. */
function minimumLevel(team: Team, floor: number, rarity: RarityId): number {
  let low = 1;
  let high = floor;
  if (measure(team, floor, high, rarity, 10).winRate < 0.5) return Infinity;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (measure(team, floor, mid, rarity, 10).winRate >= 0.5) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Partie « sans farmer » d'un héros seul : un étage après l'autre, on retente en gardant l'XP. */
function rush(classId: ClassId) {
  const team: Team = { label: classId, classes: [classId] };
  let hero = { level: 1, xp: 0 };
  return Array.from({ length: 100 }, (_, i) => {
    const floor = i + 1;
    const rarity = expectedRarity(floor);
    let attempts = 0;
    let won = false;
    while (!won && attempts < 15) {
      attempts++;
      const state = fight(team, floor, hero.level, rarity, floor * 7919 + attempts);
      hero = {
        ...hero,
        ...addXp(gameData.monsters, hero, combatRewards(gameData.monsters, state).xp.h0 ?? 0),
      };
      won = state.phase === 'victory';
    }
    return { floor, level: hero.level, attempts, won };
  });
}

const SOLO: Team[] = CLASSES.map((c) => ({ label: c, classes: [c] }));
const TRIO: Team = { label: 'trio', classes: CLASSES };
const MULTI: Team = { label: 'multi', classes: CLASSES, multiplayer: true };

const started = Date.now();
const rows = Array.from({ length: 100 }, (_, i) => {
  const floor = i + 1;
  const rarity = expectedRarity(floor);
  const solo = SOLO.map((team) => ({
    class: team.label,
    common: measure(team, floor, floor, 'common'),
    expected: measure(team, floor, floor, rarity),
    underLevel: measure(team, floor, Math.max(1, floor - 5), rarity),
    naked: measure(team, floor, floor, null),
    minimumLevel: minimumLevel(team, floor, rarity),
  }));
  const row = {
    floor,
    type: floorType(floor),
    biome: biomeOf(floor).name,
    tier: tierOf(floor),
    rarity,
    solo,
    trio: measure(TRIO, floor, floor, rarity),
    multi: measure(MULTI, floor, floor, rarity),
  };
  process.stdout.write(`\rÉtage ${floor}/100`);
  return row;
});
const rushes = Object.fromEntries(CLASSES.map((c) => [c, rush(c)]));
process.stdout.write(`\nTerminé en ${Math.round((Date.now() - started) / 1000)} s\n`);

const pct = (v: number) => `${Math.round(v * 100)} %`;
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(
  path.join(here, 'balance-report.json'),
  JSON.stringify({ RUNS, rows, rushes }, null, 2),
);

const lines = [
  `# Rapport d'équilibrage (${RUNS} combats par cas, mode auto)`,
  '',
  '| Étage | Type | Palier · rareté | Solo nu (G/M/T) | Solo Commun (G/M/T) | Solo attendu (G/M/T) | Solo −5 niv. (G/M/T) | Niveau min. 50 % (G/M/T) | Trio | Multi | Niveau sans farmer (G/M/T) |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => {
    const triple = (key: 'naked' | 'common' | 'expected' | 'underLevel') =>
      r.solo.map((s) => pct(s[key].winRate)).join(' / ');
    const rushLevels = CLASSES.map((c) => {
      const step = rushes[c]![r.floor - 1]!;
      return `${step.level}${step.won ? '' : '✗'}${step.attempts > 1 ? ` (${step.attempts})` : ''}`;
    }).join(' / ');
    return `| ${r.floor} | ${r.type} | P${r.tier} · ${r.rarity} | ${triple('naked')} | ${triple('common')} | ${triple('expected')} | ${triple('underLevel')} | ${r.solo.map((x) => (Number.isFinite(x.minimumLevel) ? x.minimumLevel : '—')).join(' / ')} | ${pct(r.trio.winRate)} | ${pct(r.multi.winRate)} | ${rushLevels} |`;
  }),
];
// Comparaison avec le joueur de référence du bestiaire (calibré au niveau 100, équipement compris).
const reference = gameData.monsters.params.referencePlayer;
const curve = gameData.monsters.params.levelCurve;
lines.push(
  '',
  '## Héros comparés au joueur de référence du bestiaire',
  '',
  "PV / stat d'attaque (Force ou Magie), deck et points de stats compris. Référence = bestiaire × courbe de niveau.",
  '',
  '| Niveau | Référence | Guerrier nu | Guerrier attendu | Mage nu | Mage attendu | Tireur nu | Tireur attendu |',
  '|---|---|---|---|---|---|---|---|',
  ...[10, 25, 50, 75, 100].map((level) => {
    const factor = levelFactor(level, curve) / levelFactor(100, curve);
    const cells = CLASSES.flatMap((classId) =>
      [null, expectedRarity(level)].map((rarity) => {
        const stats = heroCombatStats(gameData, heroSetup(classId, 0, level, level, rarity), {});
        return `${Math.round(stats.maxHp)} / ${Math.round(stats[ATTACK_STAT[classId]])}`;
      }),
    );
    return `| ${level} | ${Math.round(reference.hp * factor)} / ${Math.round(reference.attackStat * factor)} | ${cells.join(' | ')} |`;
  }),
);
writeFileSync(path.join(here, 'balance-report.md'), lines.join('\n') + '\n');
console.log('Écrit : scripts/balance-report.md et scripts/balance-report.json');
