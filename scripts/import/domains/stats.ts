import type { StatsData } from '@la-tour/shared/schemas';
import { readLevelCurve, type ImportContext } from '../context.ts';
import { SUMMARY_STATS, fromLabel } from '../labels.ts';

export function importStats({ books }: ImportContext): StatsData {
  const summary = books.stats.sheet('Résumé statistiques');
  const stats = summary.table('Catégorie').map((row) => ({
    id: fromLabel(SUMMARY_STATS, row.text('Statistique'), `${summary.where} ligne ${row.index}`),
    name: row.text('Statistique'),
    category: row.text('Catégorie'),
    improvement: row.text('Amélioration'),
    role: row.text('Effet / rôle'),
    priorities: {
      warrior: row.text('Guerrier'),
      mage: row.text('Mage'),
      ranger: row.text('Tireur'),
    },
    notes: row.text('Notes'),
  }));

  const rules = books.stats.sheet('Règles de conception');
  const designRules = rules.table('Sujet').map((row) => ({
    subject: row.text('Sujet'),
    recommendation: row.text('Recommandation'),
  }));

  // Courbe de niveau et initiative des classes : bestiaire, Paramètres §1, §2 et §9.
  const params = books.bestiary.sheet('Paramètres');
  return {
    stats,
    designRules,
    character: {
      levelCurve: readLevelCurve(params, {
        min: 'Niveau minimum',
        max: 'Niveau maximum de référence',
        base: 'Part de la valeur au niveau 1 (a)',
        exponent: 'Exposant de la courbe (p)',
      }),
      hpPerVitality: params.param('PV par point de Vitalité'),
      baseInitiativeAtMaxLevel: {
        warrior: params.param('Initiative de base du Guerrier au niveau 100'),
        mage: params.param('Initiative de base du Mage au niveau 100'),
        ranger: params.param('Initiative de base du Tireur au niveau 100'),
      },
    },
  };
}
