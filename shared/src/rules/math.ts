import type { z } from 'zod';
import type { levelCurveSchema } from '../data/schemas.ts';

export type LevelCurve = z.infer<typeof levelCurveSchema>;

/**
 * ROUND des classeurs : arrondi au plus proche, les moitiés s'éloignent de zéro.
 * `digits` peut être négatif (ROUND(x; -2) arrondit à la centaine).
 * Les classeurs ont été recalculés par LibreOffice, qui arrondit ainsi :
 * - à l'unité, sur la valeur binaire exacte (15722,4999… → 15722) ;
 * - avec décimales, après avoir ramené la valeur à 15 chiffres significatifs
 *   (2,675 → 2,68 et non 2,67 à cause du bruit binaire).
 */
export function excelRound(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (digits === 0) return sign * Math.round(abs);
  if (digits > 0) {
    const factor = 10 ** digits;
    const scaled = Number((abs * factor).toPrecision(15));
    return (sign * Math.round(scaled)) / factor;
  }
  const factor = 10 ** -digits;
  const scaled = Number((abs / factor).toPrecision(15));
  return sign * Math.round(scaled) * factor;
}

/**
 * Facteur de niveau commun aux héros, monstres et équipements :
 * a + (1 − a) × ((N − min) / (max − min)) ^ p. Vaut 1 au niveau max, plus au-delà (zones de chasse).
 */
export function levelFactor(level: number, curve: LevelCurve): number {
  const progress = (level - curve.minLevel) / (curve.maxLevel - curve.minLevel);
  return curve.base + (1 - curve.base) * progress ** curve.exponent;
}

/** Ramène un résultat à 15 chiffres significatifs, comme l'affiche un tableur (0,7 + 0,2 → 0,9). */
export function spreadsheetPrecision(value: number): number {
  return Number(value.toPrecision(15));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
