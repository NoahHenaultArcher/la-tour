/**
 * Progression des héros : XP pour monter, partage d'XP, écart de niveau, prix de référence.
 * Formules de Bestiaire_Tour_RPG.xlsx (Récompenses, Paramètres §7) ; partage d'XP : prompt §5.
 */
import { GAME_RULES, RARITY_IDS, type RarityId } from '../constants.ts';
import type { MonstersData } from '../data/schemas.ts';
import { clamp, excelRound } from './math.ts';
import { normalMonsterGold, normalMonsterXp } from './monsters.ts';

/** Niveau maximum des héros. */
export const MAX_HERO_LEVEL = 100;

/** XP pour passer du niveau `level` au suivant : XP d'un monstre Normal × (k0 + k1 × niveau). */
export function xpToNextLevel(data: MonstersData, level: number): number | null {
  if (level >= MAX_HERO_LEVEL) return null;
  const r = data.params.rewards;
  return excelRound(
    normalMonsterXp(data, level) * (r.killsPerLevelBase + r.killsPerLevelGrowth * level),
  );
}

/** XP totale nécessaire pour atteindre `level` depuis le niveau 1. */
export function cumulativeXp(data: MonstersData, level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_HERO_LEVEL); l++) total += xpToNextLevel(data, l) ?? 0;
  return total;
}

/**
 * Ajoute de l'XP à un héros et applique les montées de niveau.
 * `xp` est l'XP accumulée dans le niveau en cours. Au niveau max, l'XP n'augmente plus.
 */
export function addXp(
  data: MonstersData,
  hero: { level: number; xp: number },
  gained: number,
): { level: number; xp: number; levelsGained: number } {
  let { level, xp } = hero;
  const startLevel = level;
  xp += Math.max(0, Math.floor(gained));
  for (
    let needed = xpToNextLevel(data, level);
    needed !== null && xp >= needed;
    needed = xpToNextLevel(data, level)
  ) {
    xp -= needed;
    level += 1;
  }
  if (level >= MAX_HERO_LEVEL) xp = 0;
  return { level, xp, levelsGained: level - startLevel };
}

/** Part de l'XP reçue par chaque héros selon le nombre de héros du combat (1 → 100 %, 2 → 75 %, 3 → 50 %). */
export function xpShare(heroCount: number): number {
  const share = GAME_RULES.xpShareByHeroCount[heroCount as 1 | 2 | 3];
  if (share === undefined) throw new Error(`Nombre de héros invalide : ${heroCount}`);
  return share;
}

/** Variation d'XP selon l'écart de niveau : 1 + 10 % × (niveau monstre − niveau héros), bornée. */
export function levelGapXpFactor(
  data: MonstersData,
  monsterLevel: number,
  heroLevel: number,
): number {
  const r = data.params.rewards;
  return clamp(
    1 + r.levelGapXpStep * (monsterLevel - heroLevel),
    r.levelGapMinFactor,
    r.levelGapMaxFactor,
  );
}

/** Prix de référence d'un objet : or de N monstres Normaux du niveau, × multiplicateur par rareté. */
export function referenceItemPrice(
  data: MonstersData,
  level: number,
  rarity: Exclude<RarityId, 'unique'>,
): number {
  const r = data.params.rewards;
  const index = RARITY_IDS.indexOf(rarity);
  return excelRound(
    normalMonsterGold(data, level) * r.commonPriceInMonsters * r.rarityPriceMultiplier ** index,
  );
}
