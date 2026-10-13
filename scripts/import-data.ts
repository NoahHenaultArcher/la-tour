/**
 * Import des classeurs Excel (docs/*.xlsx) vers des JSON typés (shared/data/*.json).
 *
 * Usage : pnpm import-data
 *
 * - Lit les valeurs calculées des cellules (jamais les formules).
 * - Valide chaque domaine avec les schémas Zod de @la-tour/shared.
 * - Vérifie la cohérence entre domaines.
 * - Échoue avec un message clair au premier problème ; n'écrit rien dans ce cas.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  elementsDataSchema,
  equipmentDataSchema,
  fixturesDataSchema,
  floorsDataSchema,
  lootDataSchema,
  monstersDataSchema,
  resourcesDataSchema,
  rewardsDataSchema,
  shopDataSchema,
  skillsDataSchema,
  statsDataSchema,
  villageDataSchema,
  zonesDataSchema,
} from '@la-tour/shared/schemas';
import { checkConsistency, type ImportedData } from './import/checks.ts';
import { createContext } from './import/context.ts';
import { importBestiary } from './import/domains/bestiary.ts';
import { importElements } from './import/domains/elements.ts';
import { importEquipment } from './import/domains/equipment.ts';
import { importResources } from './import/domains/resources.ts';
import { importSkills } from './import/domains/skills.ts';
import { importStats } from './import/domains/stats.ts';
import { importVillage } from './import/domains/village.ts';
import { ImportError } from './import/workbook.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');
const assetsDir = path.join(root, 'assets_rpg_tour');
const outDir = path.join(root, 'shared', 'data');

const SCHEMAS: { [K in keyof ImportedData]: z.ZodType<ImportedData[K]> } = {
  stats: statsDataSchema,
  elements: elementsDataSchema,
  resources: resourcesDataSchema,
  equipment: equipmentDataSchema,
  skills: skillsDataSchema,
  monsters: monstersDataSchema,
  zones: zonesDataSchema,
  floors: floorsDataSchema,
  rewards: rewardsDataSchema,
  loot: lootDataSchema,
  shop: shopDataSchema,
  village: villageDataSchema,
  fixtures: fixturesDataSchema,
};

function main(): void {
  const started = Date.now();
  console.log(`Lecture des classeurs dans ${path.relative(root, docsDir)}/ …`);
  const context = createContext(docsDir, assetsDir);

  const equipment = importEquipment(context);
  const bestiary = importBestiary(context);
  const raw: ImportedData = {
    stats: importStats(context),
    elements: importElements(context),
    resources: importResources(context),
    equipment: equipment.data,
    skills: importSkills(context),
    monsters: bestiary.monsters,
    zones: bestiary.zones,
    floors: bestiary.floors,
    rewards: bestiary.rewards,
    loot: bestiary.loot,
    shop: bestiary.shop,
    village: importVillage(context),
    fixtures: { ...equipment.fixtures, ...bestiary.fixtures },
  };

  // Validation Zod de chaque domaine.
  const validated = {} as Record<keyof ImportedData, unknown>;
  for (const key of Object.keys(SCHEMAS) as (keyof ImportedData)[]) {
    const result = SCHEMAS[key].safeParse(raw[key]);
    if (!result.success) {
      throw new ImportError(`Données « ${key} » invalides :\n${z.prettifyError(result.error)}`);
    }
    validated[key] = result.data;
  }
  const data = validated as ImportedData;

  const problems = checkConsistency(data);
  if (problems.length > 0) {
    throw new ImportError(
      `Incohérences entre classeurs (${problems.length}) :\n- ${problems.join('\n- ')}`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  for (const [key, value] of Object.entries(data)) {
    const file = path.join(outDir, `${key}.json`);
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  const warnings = [...new Set(context.images.warnings)];
  if (warnings.length > 0) {
    console.warn(
      `\n⚠ ${warnings.length} image(s) manquante(s) (une image par défaut sera affichée) :`,
    );
    for (const warning of warnings) console.warn(`  - ${warning}`);
  }

  console.log(
    `\n✔ Import terminé en ${((Date.now() - started) / 1000).toFixed(1)} s → ${path.relative(root, outDir)}/`,
  );
  console.log(
    [
      `  ${data.equipment.catalog.length} équipements (${data.equipment.uniques.length} Uniques)`,
      `  ${data.skills.bases.length} compétences de base, ${data.skills.catalog.length} au catalogue, ${data.skills.fusions.length} fusions`,
      `  ${data.monsters.monsters.length} monstres, ${data.monsters.alterations.length} altérations`,
      `  ${data.zones.zones.length} zones, ${data.floors.floors.length} étages`,
      `  ${data.resources.resources.length} ressources, ${data.village.buildings.length} bâtiments, ${data.village.upgrades.length} améliorations`,
      `  ${data.elements.elements.length} éléments, ${data.rewards.levels.length} niveaux de récompenses`,
    ].join('\n'),
  );
}

try {
  main();
} catch (error) {
  if (error instanceof ImportError) {
    console.error(`\n✖ Import échoué : ${error.message}`);
    process.exit(1);
  }
  throw error;
}
