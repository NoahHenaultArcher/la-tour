/**
 * L'Abysse : étages sans fin après la tour (réglages dans balance.ts, ABYSS).
 * Le type de chaque étage (normal, boss tous les 5, tanière de dragon au hasard) est fixé par son
 * numéro : tout le monde voit la même Abysse, et l'interface peut annoncer les étages à venir.
 */
import { ABYSS } from '../balance.ts';
import type { FloorTypeId } from '../constants.ts';
import type { MonstersData } from '../data/schemas.ts';
import { createRng, nextFloat, nextInt } from './random.ts';

/** Plus grand étage accepté par l'API (garde-fou, l'Abysse n'a pas de fin en jeu). */
export const ABYSS_MAX_FLOOR = 100_000;

export function isAbyssUnlocked(highestFloorCleared: number): boolean {
  return highestFloorCleared >= ABYSS.unlockFloor;
}

/** Aléa propre à un étage (toujours le même pour un numéro donné). */
const floorRng = (floor: number) => createRng(Math.imul(floor, 2654435761) ^ 0x5eed_ab55);

/** Boss tous les 5 étages ; sinon une chance d'être une tanière de dragon ; sinon normal. */
export function abyssFloorType(floor: number): FloorTypeId {
  if (floor % 5 === 0) return 'boss';
  return nextFloat(floorRng(floor)) < ABYSS.dragonChance ? 'dragon' : 'normal';
}

/** Niveau des monstres d'un étage de l'Abysse. */
export function abyssMonsterLevel(floor: number): number {
  return ABYSS.unlockFloor + floor * ABYSS.levelsPerFloor;
}

/** Renfort des PV et de l'attaque d'un monstre d'un étage (facteur propre aux boss et aux dragons). */
export function abyssDifficulty(
  floor: number,
  rank: MonstersData['monsters'][number]['rank'] = 'normal',
): { hp: number; attack: number } {
  const steps = Math.max(0, floor - 1);
  const factor = rank === 'dragon' ? ABYSS.dragonFactor : rank === 'boss' ? ABYSS.bossFactor : 1;
  return {
    hp: ABYSS.hpBase * (1 + ABYSS.hpGrowth) ** steps * factor,
    attack: ABYSS.attackBase * (1 + ABYSS.attackGrowth) ** steps * factor,
  };
}

const isRegular = (m: MonstersData['monsters'][number]) => m.rank !== 'boss' && m.rank !== 'dragon';

/** Monstres ordinaires de toutes les zones (vagues de l'Abysse, renforts des dragons). */
export function abyssRegulars(data: MonstersData) {
  return data.monsters.filter(isRegular);
}

export function abyssBosses(data: MonstersData) {
  return data.monsters.filter((m) => m.rank === 'boss');
}

/** Dragon d'une tanière de l'Abysse (null si l'étage n'en est pas une). */
export function abyssDragon(data: MonstersData, floor: number) {
  if (abyssFloorType(floor) !== 'dragon') return null;
  const dragons = data.monsters.filter((m) => m.rank === 'dragon');
  const rng = floorRng(floor);
  nextFloat(rng); // Le premier tirage a décidé du type de l'étage.
  return dragons[nextInt(rng, dragons.length)] ?? null;
}

/** Facteur des chances de Mythique et Légendaire dans le butin d'un étage. */
export function abyssHighRarityBoost(floor: number): number {
  return Math.min(ABYSS.highRarityMaxBoost, 1 + ABYSS.highRarityGrowth * floor);
}
