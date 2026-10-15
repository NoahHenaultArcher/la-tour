import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { createLeaderboardCache } from './service.ts';

export async function leaderboardRoutes(
  app: FastifyInstance,
  {
    prisma,
    rateLimits,
    cacheMs,
  }: { prisma: PrismaClient; rateLimits: RateLimits; cacheMs?: number },
): Promise<void> {
  const auth = requireUser(prisma);
  const leaderboard = createLeaderboardCache(prisma, cacheMs);

  app.get(
    '/api/leaderboard',
    { preHandler: auth, config: { rateLimit: perUser(rateLimits.sensitive) } },
    async (request) => leaderboard(currentUser(request).id),
  );
}
