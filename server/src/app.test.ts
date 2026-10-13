import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../test/helpers.ts';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

// Ces tests n'ont pas besoin de base : la vérification de la base est simulée.
const noPrisma = {} as PrismaClient;

describe('GET /api/health', () => {
  it('répond ok quand la base répond', async () => {
    const app = buildApp({
      prisma: noPrisma,
      config: testConfig(),
      checkDatabase: async () => {},
      logger: false,
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      data: { equipment: 930, skills: 484, monsters: 92, floors: 100 },
    });
  });

  it('signale une base injoignable (503)', async () => {
    const app = buildApp({
      prisma: noPrisma,
      config: testConfig(),
      checkDatabase: async () => {
        throw new Error('connexion refusée');
      },
      logger: false,
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });

  it('renvoie une erreur 404 au format de l’API', async () => {
    const app = buildApp({
      prisma: noPrisma,
      config: testConfig(),
      checkDatabase: async () => {},
      logger: false,
    });
    const response = await app.inject({ method: 'GET', url: '/api/inconnu' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND' } });
  });
});

describe('configuration', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(config).toMatchObject({ NODE_ENV: 'development', SERVER_PORT: 3000 });
  });

  it('refuse une configuration incomplète avec un message clair', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/PostgreSQL/);
  });
});
