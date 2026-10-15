/**
 * Calibrage de l'Abysse : jusqu'où descend une équipe niveau 100, selon son équipement et ses héritages ?
 *
 * Usage : pnpm --filter @la-tour/scripts abyss-sim [descentes par profil, 10 par défaut]
 *
 * Hypothèses : trio Guerrier + Mage + Tireur niveau 100, solo (3 actions par manche), mode auto ;
 * deck complet de la simulation de shared ; points moitié Vitalité, moitié stat d'attaque ;
 * 10 objets adamantite améliorés au maximum, Épiques (« attendu » en fin de tour) ou Légendaires
 * (« bien équipé ») ; ni Tour d'amélioration, ni fusion.
 * « Mur » : premier étage pas franchi en ATTEMPTS essais (comme un joueur qui retente).
 * Ne modifie aucun réglage : écrit seulement abyss-sim.md.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABYSS,
  ALLOCATABLE_STATS,
  SLOT_IDS,
  STAT_POINTS,
  abyssFloorType,
  createCombat,
  itemStats,
  playAutoTurn,
  starterDeckFor,
  type ClassId,
  type HeroSetup,
  type RarityId,
  type StatAllocation,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

const RUNS = Number(process.argv[2] ?? 10);
// Essai de réglages sans toucher au code : ABYSS_TRY='{"hpBase":1.5}' (appliqué en mémoire seulement).
if (process.env.ABYSS_TRY) Object.assign(ABYSS, JSON.parse(process.env.ABYSS_TRY));
const MAX_FLOOR = 80;
const MAX_ROUNDS = 150;
/** Essais par étage avant d'abandonner. */
const ATTEMPTS = 10;
const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];
const ATTACK_STAT: Record<ClassId, 'strength' | 'magic'> = {
  warrior: 'strength',
  mage: 'magic',
  ranger: 'strength',
};
const FULL_DECKS: Record<ClassId, string[]> = {
  warrior: ['GUE-A01-NEU', 'GUE-A04-NEU', 'GUE-A07-NEU', 'GUE-P02', 'GUE-P04'],
  mage: ['MAG-A01-NEU', 'MAG-A03-NEU', 'MAG-A07-NEU', 'MAG-P01', 'MAG-P02'],
  ranger: ['TIR-A02-NEU', 'TIR-A03-NEU', 'TIR-A07-NEU', 'TIR-P01', 'TIR-P07'],
};

function allocation(classId: ClassId): StatAllocation {
  const points = 99 * STAT_POINTS.perLevel;
  const result = Object.fromEntries(ALLOCATABLE_STATS.map((s) => [s, 0])) as StatAllocation;
  result.vitality = Math.floor(points / 2);
  result[ATTACK_STAT[classId]] = points - result.vitality;
  return result;
}

function hero(classId: ClassId, i: number, rarity: RarityId, heritageCount: number): HeroSetup {
  const deck = FULL_DECKS[classId].map((skillId, position) => ({ position, skillId }));
  if (deck.length < 5) deck.push(...starterDeckFor(gameData, classId));
  return {
    characterId: `h${i}`,
    classId,
    level: 100,
    heritageCount,
    equipment: SLOT_IDS.map((slot) => {
      const item = gameData.equipment.catalog.find(
        (c) => c.classId === classId && c.slot === slot && c.tier === 5 && c.rarity === rarity,
      )!;
      return itemStats(gameData.equipment, item, item.maxUpgrade);
    }),
    deck,
    allocation: allocation(classId),
  };
}

/** Un combat d'un étage de l'Abysse ; vrai si gagné. */
function fight(floor: number, rarity: RarityId, heritageCount: number, seed: number): boolean {
  let { state } = createCombat(gameData, {
    floor,
    mode: 'abyss',
    heroes: CLASSES.map((c, i) => hero(c, i, rarity, heritageCount)),
    tower: {},
    seed,
  });
  while (state.phase === 'heroes' && state.round <= MAX_ROUNDS)
    state = playAutoTurn(gameData, state).state;
  return state.phase === 'victory';
}

interface Profile {
  label: string;
  rarity: RarityId;
  heritage: number;
}
const PROFILES: Profile[] = (['epic', 'legendary'] as const).flatMap((rarity) =>
  [0, 1, 2, 3].map((heritage) => ({
    label: `${rarity === 'epic' ? 'Épique' : 'Légendaire'} · ${heritage} héritage(s)`,
    rarity,
    heritage,
  })),
);

/**
 * Descente d'un joueur : chaque étage est retenté jusqu'à ATTEMPTS fois (le boss change à chaque
 * essai). Le mur est le premier étage pas franchi. Moyenne sur RUNS descentes.
 */
function descend(profile: Profile, run: number) {
  const attempts: number[] = [];
  for (let floor = 1; floor <= MAX_FLOOR; floor++) {
    let tries = 0;
    let won = false;
    while (!won && tries < ATTEMPTS) {
      tries++;
      won = fight(floor, profile.rarity, profile.heritage, run * 1_000_003 + floor * 7919 + tries);
    }
    attempts.push(tries);
    if (!won) return { wall: floor, attempts };
  }
  return { wall: null, attempts };
}

const started = Date.now();
const results = PROFILES.map((profile) => {
  const runs = Array.from({ length: RUNS }, (_, run) => descend(profile, run));
  const walls = runs.map((r) => r.wall ?? MAX_FLOOR + 1).sort((a, b) => a - b);
  const median = walls[Math.floor(walls.length / 2)]!;
  // Étages qui ont arrêté au moins une descente, et combien de fois.
  const stops = new Map<number, number>();
  for (const w of walls) stops.set(w, (stops.get(w) ?? 0) + 1);
  process.stdout.write(`${profile.label} : mur médian ${median} (de ${walls[0]} à ${walls.at(-1)})
`);
  return { ...profile, walls, median, stops };
});
process.stdout.write(`Terminé en ${Math.round((Date.now() - started) / 1000)} s
`);

const lairs = Array.from({ length: MAX_FLOOR }, (_, i) => i + 1).filter(
  (f) => abyssFloorType(f) === 'dragon',
);
const lines = [
  `# Calibrage de l'Abysse (${RUNS} descentes par profil, ${ATTEMPTS} essais par étage, trio niveau 100, mode auto)`,
  '',
  `Tanières de dragon (étages 1 à ${MAX_FLOOR}) : ${lairs.join(', ')}.`,
  '',
  '| Équipement · héritages | Mur médian | Murs observés (étage × descentes) |',
  '|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.label} | ${r.median > MAX_FLOOR ? `> ${MAX_FLOOR}` : r.median} | ${[...r.stops]
        .map(
          ([floor, n]) =>
            `${floor > MAX_FLOOR ? '—' : `${floor} (${abyssFloorType(floor)})`} × ${n}`,
        )
        .join(', ')} |`,
  ),
];
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(here, 'abyss-sim.md'), lines.join('\n') + '\n');
console.log('Écrit : scripts/abyss-sim.md');
