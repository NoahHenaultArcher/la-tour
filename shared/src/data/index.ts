/**
 * Données du jeu, générées par `pnpm import-data` et validées par Zod au chargement.
 * Ne pas modifier les JSON à la main : modifier les classeurs puis relancer l'import.
 */
import elementsJson from '../../data/elements.json' with { type: 'json' };
import equipmentJson from '../../data/equipment.json' with { type: 'json' };
import floorsJson from '../../data/floors.json' with { type: 'json' };
import lootJson from '../../data/loot.json' with { type: 'json' };
import monstersJson from '../../data/monsters.json' with { type: 'json' };
import resourcesJson from '../../data/resources.json' with { type: 'json' };
import rewardsJson from '../../data/rewards.json' with { type: 'json' };
import shopJson from '../../data/shop.json' with { type: 'json' };
import skillsJson from '../../data/skills.json' with { type: 'json' };
import statsJson from '../../data/stats.json' with { type: 'json' };
import villageJson from '../../data/village.json' with { type: 'json' };
import zonesJson from '../../data/zones.json' with { type: 'json' };
import type { z } from 'zod';
import {
  elementsDataSchema,
  equipmentDataSchema,
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
} from './schemas.ts';

/**
 * Défini à `true` par Vite dans le build de production du client (client/vite.config.ts) : les données
 * y sont déjà validées par le script d'import et par le serveur au démarrage, on évite donc de
 * revalider ~1,5 Mo de JSON à chaque ouverture du jeu. Les schémas n'ont aucune transformation :
 * les données validées sont identiques au JSON. Partout ailleurs (serveur, tests, développement),
 * la validation reste faite.
 */
declare const __TRUSTED_GAME_DATA__: boolean | undefined;
const trusted = typeof __TRUSTED_GAME_DATA__ !== 'undefined' && __TRUSTED_GAME_DATA__;

function load<T extends z.ZodType>(name: string, schema: T, json: unknown): z.infer<T> {
  if (trusted) return json as z.infer<T>;
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Données « ${name} » invalides (relancer pnpm import-data) : ${result.error.message}`,
    );
  }
  return result.data;
}

export const gameData = {
  stats: load('stats', statsDataSchema, statsJson),
  elements: load('elements', elementsDataSchema, elementsJson),
  resources: load('resources', resourcesDataSchema, resourcesJson),
  equipment: load('equipment', equipmentDataSchema, equipmentJson),
  skills: load('skills', skillsDataSchema, skillsJson),
  monsters: load('monsters', monstersDataSchema, monstersJson),
  zones: load('zones', zonesDataSchema, zonesJson),
  floors: load('floors', floorsDataSchema, floorsJson),
  rewards: load('rewards', rewardsDataSchema, rewardsJson),
  loot: load('loot', lootDataSchema, lootJson),
  shop: load('shop', shopDataSchema, shopJson),
  village: load('village', villageDataSchema, villageJson),
};

export type GameData = typeof gameData;
