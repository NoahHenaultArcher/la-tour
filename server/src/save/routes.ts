import type { PrismaClient } from '@prisma/client';
import { chooseClassBodySchema } from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { chooseStartingClass, loadSave } from './service.ts';

export async function saveRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const auth = requireUser(prisma);

  app.get('/api/save', { preHandler: auth }, async (request) =>
    loadSave(prisma, currentUser(request).id),
  );

  app.post(
    '/api/save/class',
    { preHandler: auth, config: { rateLimit: perUser(rateLimits.sensitive) } },
    async (request) => {
      const { classId } = parseInput(chooseClassBodySchema, request.body);
      const user = currentUser(request);
      await chooseStartingClass(prisma, user.id, classId);
      return loadSave(prisma, user.id);
    },
  );
}
