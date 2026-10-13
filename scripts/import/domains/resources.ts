import type { ResourcesData } from '@la-tour/shared/schemas';
import type { ImportContext } from '../context.ts';
import { RESOURCE_SOURCES, fromLabel, slugify } from '../labels.ts';
import { ImportError } from '../workbook.ts';

/**
 * Ressources : onglet Matériaux (équipements) pour les matériaux d'amélioration,
 * complété par l'onglet Production (village) pour celles qui ne servent qu'à construire (charbon).
 */
export function importResources({ books, images }: ImportContext): ResourcesData {
  const materials = books.equipment.sheet('Matériaux');
  // Le tableau est suivi d'une note, sans ligne vide entre les deux.
  const resources = materials
    .table('Matériau', { until: (row) => row.raw('Palier') === null })
    .map((row) => {
      const name = row.text('Matériau');
      const floor = row.raw('Étage');
      const id = slugify(name);
      return {
        id,
        name,
        tier: row.int('Palier'),
        source: fromLabel(
          RESOURCE_SOURCES,
          row.text("Où l'obtenir"),
          `${materials.where} ligne ${row.index}`,
        ),
        unlockFloor: floor === 'Village' ? 0 : row.int('Étage'),
        image: images.get('ressource', id),
      };
    });

  const production = books.village.sheet('Production');
  for (const row of production.table('Bâtiment').rows) {
    const name = row.text('Ressource');
    const id = slugify(name);
    const tier = row.int('Palier');
    const floor = row.int('Étage requis');
    const known = resources.find((r) => r.id === id);
    if (known) {
      if (known.tier !== tier || known.unlockFloor !== floor) {
        throw new ImportError(
          `${production.where} ligne ${row.index} : « ${name} » est au palier ${tier}, étage ${floor}, mais au palier ${known.tier}, étage ${known.unlockFloor} dans Équipements › Matériaux.`,
        );
      }
      continue;
    }
    resources.push({
      id,
      name,
      tier,
      source: fromLabel(
        RESOURCE_SOURCES,
        row.text('Bâtiment'),
        `${production.where} ligne ${row.index}`,
      ),
      unlockFloor: floor,
      image: images.get('ressource', id),
    });
  }

  return { resources };
}
