import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('client compilé (production)', () => {
  let clientDir: string;

  beforeAll(() => {
    clientDir = mkdtempSync(path.join(tmpdir(), 'la-tour-client-'));
    mkdirSync(path.join(clientDir, 'assets'));
    writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>La Tour</title>');
    writeFileSync(path.join(clientDir, 'assets', 'index-abc123.js'), 'console.log(1);');
  });
  afterAll(() => rmSync(clientDir, { recursive: true, force: true }));

  const app = () =>
    buildApp({
      prisma: noPrisma,
      config: testConfig(),
      checkDatabase: async () => {},
      logger: false,
      clientDir,
    });

  it('sert la page du jeu, y compris sur un lien direct', async () => {
    for (const url of ['/', '/village', '/combat?mode=solo']) {
      const response = await app().inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body).toContain('La Tour');
    }
  });

  it('met en cache les fichiers de Vite', async () => {
    const response = await app().inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('garde les 404 pour l’API et les fichiers absents', async () => {
    const api = await app().inject({ method: 'GET', url: '/api/inconnu' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    const image = await app().inject({ method: 'GET', url: '/village/absent.png' });
    expect(image.statusCode).toBe(404);
  });
});

describe('configuration', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      SERVER_PORT: 3000,
      HOST: '127.0.0.1',
      TRUST_PROXY: false,
    });
    expect(config.PORT).toBeUndefined();
  });

  it('lit les réglages d’un hébergeur', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      PORT: '10000',
      HOST: '0.0.0.0',
      TRUST_PROXY: 'true',
    });
    expect(config).toMatchObject({ PORT: 10000, HOST: '0.0.0.0', TRUST_PROXY: true });
  });

  it('refuse une configuration incomplète avec un message clair', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/PostgreSQL/);
  });
});
