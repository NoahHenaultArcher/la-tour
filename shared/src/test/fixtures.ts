/** Cas de test extraits des onglets « calculateur » des classeurs (utilisés uniquement par les tests). */
import fixturesJson from '../../data/fixtures.json' with { type: 'json' };
import { fixturesDataSchema } from '../data/schemas.ts';

export const fixtures = fixturesDataSchema.parse(fixturesJson);
