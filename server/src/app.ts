import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { gameData } from '@la-tour/shared/data';
import { authRoutes } from './auth/routes.ts';
import { characterRoutes } from './characters/routes.ts';
import { combatRoutes } from './combat/routes.ts';
import type { Config } from './config.ts';
import { debugRoutes } from './debug/routes.ts';
import { HttpError, registerErrorHandling } from './http/errors.ts';
import { itemRoutes } from './items/routes.ts';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './http/rate-limits.ts';
import { saveRoutes } from './save/routes.ts';
import { shopRoutes } from './shop/routes.ts';
import { villageRoutes } from './village/routes.ts';

export interface AppDependencies {
  prisma: PrismaClient;
  config: Config;
  logger?: boolean;
  /** Vérifie que la base répond ; par défaut « SELECT 1 » via Prisma. */
  checkDatabase?: () => Promise<void>;
  rateLimits?: RateLimits;
}

export function buildApp({
  prisma,
  config,
  logger = true,
  checkDatabase,
  rateLimits = DEFAULT_RATE_LIMITS,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger });
  const pingDatabase =
    checkDatabase ??
    (async () => {
      await prisma.$queryRaw`SELECT 1`;
    });

  app.decorateRequest('user', null);
  registerErrorHandling(app);
  app.register(cookie);
  app.register(rateLimit, {
    global: false,
    // Après l'analyse du corps et l'authentification : la limite peut viser le compte.
    hook: 'preHandler',
    errorResponseBuilder: (_request, context) =>
      new HttpError(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: Math.ceil(context.ttl / 1000) }),
  });

  app.get('/api/health', async (_request, reply) => {
    let database: 'ok' | 'unavailable' = 'ok';
    try {
      await pingDatabase();
    } catch (error) {
      app.log.warn({ err: error }, 'base de données injoignable');
      database = 'unavailable';
    }
    return reply.status(database === 'ok' ? 200 : 503).send({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      data: {
        equipment: gameData.equipment.catalog.length,
        skills: gameData.skills.catalog.length,
        monsters: gameData.monsters.monsters.length,
        floors: gameData.floors.floors.length,
      },
    });
  });

  app.register(authRoutes, { prisma, config, rateLimits });
  app.register(saveRoutes, { prisma, rateLimits });
  app.register(villageRoutes, { prisma, rateLimits });
  app.register(combatRoutes, { prisma, rateLimits });
  app.register(itemRoutes, { prisma, rateLimits });
  app.register(characterRoutes, { prisma, rateLimits });
  app.register(shopRoutes, { prisma, rateLimits });
  // Mode debug : jamais disponible en production.
  if (config.NODE_ENV !== 'production') app.register(debugRoutes, { prisma, rateLimits });

  return app;
}
