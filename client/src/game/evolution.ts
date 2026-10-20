/**
 * Évolutions des classes côté interface : nom et portrait d'un héros selon les héritages du compte
 * (Mage → Mage arcaniste → Archimage…). Les règles sont dans @la-tour/shared (rules/evolution.ts).
 */
import { evolutionOf, evolutionTier, type ClassId, type EvolutionTier } from '@la-tour/shared';
import { t } from '../i18n/index.ts';
import { CLASS_IMAGES, EVOLUTION_IMAGES } from './assets.ts';

/** Nom affiché d'un héros : celui de son évolution, sinon celui de sa classe. */
export function heroName(classId: ClassId, tier: EvolutionTier = 0): string {
  const evolution = evolutionOf(classId, tier);
  return evolution ? t(`evolution.name.${evolution}`) : t(`class.name.${classId}`);
}

/** Portrait d'un héros selon son évolution. */
export function heroImage(classId: ClassId, tier: EvolutionTier = 0): string {
  const evolution = evolutionOf(classId, tier);
  return evolution ? EVOLUTION_IMAGES[evolution] : CLASS_IMAGES[classId];
}

/** Palier d'évolution d'une sauvegarde (commun à tous ses héros). */
export function saveTier(save: { heritageCount: number } | null | undefined): EvolutionTier {
  return evolutionTier(save?.heritageCount ?? 0);
}
