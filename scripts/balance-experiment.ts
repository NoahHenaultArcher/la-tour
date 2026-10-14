/**
 * Expérience de calibrage : modifie EN MÉMOIRE les stats de base des héros (aucun fichier touché)
 * et résume les taux de victoire par type d'étage.
 * Usage : tsx balance-experiment.ts <facteur à bas niveau> <facteur au niveau 100> [essais]
 * Le facteur passe linéairement de l'un à l'autre selon le niveau du héros.
 */
import {
  HERO_BASE_EQUIPMENT_STATS,
  HERO_BASE_STATS_AT_MAX_LEVEL,
  RARITY_IDS,
  SLOT_IDS,
  STAT_POINTS,
  addXp,
  combatRewards,
  createCombat,
  floorType,
  itemStats,
  playAutoForHero,
  playAutoTurn,
  starterDeckFor,
  type ClassId,
  type HeroSetup,
  type RarityId,
  type StatBlock,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

const [
  lowFactor = 1,
  highFactor = lowFactor,
  hpLow = 1,
  hpHigh = hpLow,
  atkLow = 1,
  atkHigh = atkLow,
  runsArg = 12,
] = process.argv.slice(2).map(Number);
const RUNS = runsArg;
const ORIGINAL = structuredClone(HERO_BASE_STATS_AT_MAX_LEVEL);
const REFERENCE = structuredClone(gameData.monsters.params.referencePlayer);
const lerp = (a: number, b: number, level: number) => a + ((b - a) * (level - 1)) / 99;
/** Applique le facteur du niveau aux stats de base (lues à la création du combat). */
function scaleFor(level: number) {
  // Résistance aux altérations de base du héros, comme le monstre étalon (5 % → 30 %), si STATUS=1.
  if (process.env.STATUS === '1')
    (HERO_BASE_EQUIPMENT_STATS as Record<string, number>).statusResistance = lerp(0.05, 0.3, level);
  const f = lerp(lowFactor, highFactor, level);
  for (const [classId, stats] of Object.entries(ORIGINAL)) {
    const target = HERO_BASE_STATS_AT_MAX_LEVEL[classId as ClassId];
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) target[key] = stats[key] * f;
  }
}
/** Monstres de l'étage : PV et attaque × facteur (via le joueur de référence du bestiaire). */
function scaleMonsters(floor: number) {
  const ref = gameData.monsters.params.referencePlayer as { hp: number; damagePerTurn: number };
  ref.damagePerTurn = REFERENCE.damagePerTurn * lerp(hpLow, hpHigh, floor);
  ref.hp = REFERENCE.hp * lerp(atkLow, atkHigh, floor);
}

const CLASSES: ClassId[] = ['warrior', 'mage', 'ranger'];
const ATTACK: Record<ClassId, 'strength' | 'magic'> = {
  warrior: 'strength',
  mage: 'magic',
  ranger: 'strength',
};
const FULL: Record<ClassId, string[]> = {
  warrior: ['GUE-A01-NEU', 'GUE-A04-NEU', 'GUE-A07-NEU', 'GUE-P02', 'GUE-P04'],
  mage: ['MAG-A01-NEU', 'MAG-A03-NEU', 'MAG-A07-NEU', 'MAG-P01', 'MAG-P02'],
  ranger: ['TIR-A02-NEU', 'TIR-A03-NEU', 'TIR-A07-NEU', 'TIR-P01', 'TIR-P07'],
};
const baseOf = (id: string) =>
  gameData.skills.bases.find(
    (b) => b.id === gameData.skills.catalog.find((s) => s.id === id)!.baseId,
  )!;
function deckFor(classId: ClassId, level: number): HeroSetup['deck'] {
  const deck: HeroSetup['deck'] = [];
  const used = new Set<string>();
  FULL[classId].forEach((id, position) => {
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
const tierOf = (floor: number) =>
  gameData.equipment.tiers.filter((t) => t.unlockFloor <= floor).at(-1)!.tier;
const biome = (floor: number) =>
  gameData.elements.biomes.find((b) => floor >= b.floorMin && floor <= b.floorMax)!.id;
function expectedRarity(floor: number): RarityId {
  const w = gameData.loot.rarityTables.boss.find((r) => r.biome === biome(floor))!.weights;
  let c = 0;
  for (const r of RARITY_IDS) {
    if (r === 'unique') continue;
    c += w[r] ?? 0;
    if (c >= 0.5) return r;
  }
  return 'common';
}
function gear(classId: ClassId, floor: number, rarity: RarityId | null): StatBlock[] {
  if (!rarity) return [];
  return SLOT_IDS.map((slot) => {
    const item = gameData.equipment.catalog.find(
      (c) =>
        c.classId === classId && c.slot === slot && c.tier === tierOf(floor) && c.rarity === rarity,
    )!;
    return itemStats(
      gameData.equipment,
      item,
      Math.min(Math.max(0, floor - item.baseLevel), item.maxUpgrade),
    );
  });
}
function hero(
  classId: ClassId,
  i: number,
  floor: number,
  level: number,
  rarity: RarityId | null,
): HeroSetup {
  const p = Math.max(0, level - 1) * STAT_POINTS.perLevel;
  return {
    characterId: `h${i}`,
    classId,
    level,
    heritageCount: 0,
    equipment: gear(classId, floor, rarity),
    deck: deckFor(classId, level),
    allocation: {
      vitality: Math.floor(p / 2),
      strength: ATTACK[classId] === 'strength' ? p - Math.floor(p / 2) : 0,
      magic: ATTACK[classId] === 'magic' ? p - Math.floor(p / 2) : 0,
      resistance: 0,
      agility: 0,
    },
  };
}
function fight(
  classes: ClassId[],
  floor: number,
  level: number,
  rarity: RarityId | null,
  seed: number,
  multi = false,
) {
  scaleFor(level);
  scaleMonsters(floor);
  let { state } = createCombat(gameData, {
    floor,
    heroes: classes.map((c, i) => hero(c, i, floor, level, rarity)),
    tower: {},
    seed,
    multiplayer: multi,
  });
  while (state.phase === 'heroes' && state.round <= 150) {
    if (!multi) {
      state = playAutoTurn(gameData, state).state;
      continue;
    }
    const id = state.heroes.find((h) => (state.heroActions?.[h.id] ?? 0) > 0)?.id;
    if (!id) break;
    state = playAutoForHero(gameData, state, id).state;
  }
  return state;
}
function rate(
  classes: ClassId[],
  floor: number,
  level: number,
  rarity: RarityId | null,
  multi = false,
) {
  let w = 0;
  for (let s = 1; s <= RUNS; s++)
    if (
      fight(classes, floor, Math.max(1, level), rarity, floor * 977 + s, multi).phase === 'victory'
    )
      w++;
  return w / RUNS;
}
const solo = (floor: number, level: number, rarity: RarityId | null) =>
  CLASSES.reduce((s, c) => s + rate([c], floor, level, rarity), 0) / 3;
const pct = (v: number) => `${Math.round(v * 100)}`.padStart(3);
const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

console.log(
  `héros ×${lowFactor}→×${highFactor} · PV monstres ×${hpLow}→×${hpHigh} · attaque monstres ×${atkLow}→×${atkHigh}`,
);
const floors = Array.from({ length: 100 }, (_, i) => i + 1);
const bosses = floors.filter((f) => floorType(f) === 'boss' && f >= 15);
const dragons = floors.filter((f) => floorType(f) === 'dragon');
const normals = floors.filter((f) => f % 10 === 3 || f % 10 === 7);

const bossRates = bosses.map((f) => solo(f, f, expectedRarity(f)));
console.log(
  `boss attendu@étage : moy ${pct(avg(bossRates))} · ${bosses.map((f, i) => `${f}:${pct(bossRates[i]!)}`).join(' ')}`,
);
const nakedRates = bosses.map((f) => solo(f, f, null));
console.log(
  `boss nu@étage      : moy ${pct(avg(nakedRates))} · ${bosses.map((f, i) => `${f}:${pct(nakedRates[i]!)}`).join(' ')}`,
);
const underRates = bosses.map((f) => solo(f, f - 5, expectedRarity(f)));
console.log(`boss attendu@−5    : moy ${pct(avg(underRates))}`);
const dragonRates = dragons.map((f) => solo(f, f, expectedRarity(f)));
console.log(
  `dragons attendu    : moy ${pct(avg(dragonRates))} · ${dragons.map((f, i) => `${f}:${pct(dragonRates[i]!)}`).join(' ')}`,
);
const normalRates = normals.map((f) => solo(f, f, expectedRarity(f)));
console.log(
  `normaux attendu    : moy ${pct(avg(normalRates))} · min ${pct(Math.min(...normalRates))}`,
);
const early = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((f) => solo(f, f, null));
console.log(`début (1-10) nu    : ${early.map(pct).join(' ')}`);
const duo = bosses
  .filter((_, i) => i % 3 === 0)
  .map((f) => rate(['warrior', 'mage'], f, f, expectedRarity(f)));
const trio = bosses
  .filter((_, i) => i % 3 === 0)
  .map((f) => rate(CLASSES, f, f, expectedRarity(f)));
const multi = bosses
  .filter((_, i) => i % 3 === 0)
  .map((f) => rate(CLASSES, f, f, expectedRarity(f), true));
console.log(`boss duo / trio / multi : ${pct(avg(duo))} / ${pct(avg(trio))} / ${pct(avg(multi))}`);

for (const f of [25, 45, 50, 80])
  console.log(
    `boss ${f} attendu à +0/+5/+10 niveaux : ${[0, 5, 10].map((d) => pct(solo(f, f + d, expectedRarity(f)))).join(' / ')}`,
  );

// Partie sans chasser, héros seul avec l'équipement attendu : où bloque-t-on ?
for (const classId of CLASSES) {
  let h = { level: 1, xp: 0 };
  const notes: string[] = [];
  let total = 0;
  for (let floor = 1; floor <= 100; floor++) {
    let tries = 0;
    let won = false;
    while (!won && tries < 20) {
      tries++;
      const st = fight([classId], floor, h.level, expectedRarity(floor), floor * 31 + tries);
      h = { ...h, ...addXp(gameData.monsters, h, combatRewards(gameData.monsters, st).xp.h0 ?? 0) };
      won = st.phase === 'victory';
    }
    total += tries;
    if (tries >= 5) notes.push(`é${floor}×${tries}`);
    if (!won) {
      notes.push(`BLOQUÉ é${floor} niv ${h.level}`);
      break;
    }
    if (floor % 25 === 0) notes.push(`[é${floor} niv ${h.level}]`);
  }
  console.log(`sans chasse ${classId}: ${total} combats · ${notes.join(' ')}`);
}
