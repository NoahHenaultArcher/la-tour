import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { describe, inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { createPrisma } from '../src/db.ts';
import type { RateLimits } from '../src/http/rate-limits.ts';
import type { ManagerOptions } from '../src/multiplayer/manager.ts';

export const testDatabaseUrl = inject('testDatabaseUrl');

/** describe() qui n'est exécuté que si la base de test est disponible. */
export const describeWithDb = testDatabaseUrl ? describe : describe.skip;

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    SERVER_PORT: 0,
    HOST: '127.0.0.1',
    TRUST_PROXY: false,
    DATABASE_URL: testDatabaseUrl ?? 'postgresql://absent',
    CLIENT_ORIGIN: 'http://localhost:5173',
    ...overrides,
  };
}

export interface TestContext {
  prisma: PrismaClient;
  app: FastifyInstance;
}

/** Limites très hautes : les tests enchaînent les inscriptions depuis la même adresse. */
const RELAXED_RATE_LIMITS: RateLimits = {
  register: { max: 10_000, timeWindow: '1 minute' },
  login: { max: 10_000, timeWindow: '1 minute' },
  sensitive: { max: 10_000, timeWindow: '1 minute' },
  combat: { max: 10_000, timeWindow: '1 minute' },
};

export async function createTestContext(
  overrides: Partial<Config> = {},
  rateLimits: RateLimits = RELAXED_RATE_LIMITS,
  multiplayer?: ManagerOptions,
): Promise<TestContext> {
  const prisma = createPrisma(testDatabaseUrl!);
  const app = buildApp({
    prisma,
    config: testConfig(overrides),
    logger: false,
    rateLimits,
    multiplayer,
    leaderboardCacheMs: 0,
  });
  await app.ready();
  return { prisma, app };
}

export async function closeTestContext({ prisma, app }: TestContext): Promise<void> {
  await app.close();
  await prisma.$disconnect();
}

/** Vide toutes les tables (schéma de test uniquement). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "Session", "Save", "Character", "CharacterSkill", "Item", "ResourceStock", "Building", "UpgradeTowerLevel" CASCADE',
  );
}

/** Cookie de session renvoyé par une réponse, prêt à être renvoyé (« latour_session=… »). */
export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === 'latour_session');
  if (!cookie) throw new Error(`Pas de cookie de session (statut ${response.statusCode})`);
  return `${cookie.name}=${cookie.value}`;
}

export const PASSWORD = 'mot-de-passe-solide';

export async function register(
  app: FastifyInstance,
  username: string,
  password = PASSWORD,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
  return sessionCookie(response);
}

/** Crée un compte admin avec un personnage et renvoie son cookie de session. */
export async function registerAdmin(
  { app, prisma }: TestContext,
  username = 'chef',
): Promise<string> {
  const cookie = await register(app, username);
  await prisma.user.update({
    where: { usernameKey: username.toLowerCase() },
    data: { role: 'admin' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/save/class',
    headers: { cookie },
    payload: { classId: 'mage' },
  });
  return cookie;
}
