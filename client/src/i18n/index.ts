import type { ApiErrorCode } from '@la-tour/shared';
import { ApiError } from '../api/client.ts';
import fr from './fr.json';

export type TranslationKey = keyof typeof fr;

/** Texte affiché : tous les libellés de l'interface viennent de fr.json. « {nom} » est remplacé par vars.nom. */
export function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
  return fr[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Message affichable pour une erreur (code de l'API ou erreur inattendue). */
export function errorMessage(error: unknown): string {
  const code: ApiErrorCode = error instanceof ApiError ? error.code : 'INTERNAL';
  return t(`errors.${code}`);
}

/** Nombre au format français (espaces fines entre milliers). */
export function formatNumber(value: number): string {
  return value.toLocaleString('fr-FR');
}
