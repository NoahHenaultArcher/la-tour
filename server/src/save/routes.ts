import type { PrismaClient } from '@prisma/client';
import { chooseClassBodySchema } from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { HttpError, parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import type { MultiplayerManager } from '../multiplayer/manager.ts';
import { chooseStartingClass, getSaveId, loadSave, performHeritage } from './service.ts';

export async function saveRoutes(
  app: FastifyInstance,
  {
    prisma,
    rateLimits,
    multiplayer,
  }: { prisma: PrismaClient; rateLimits: RateLimits; multiplayer: MultiplayerManager },
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

  // Héritage : recommence la tour avec +25 % de stats (dès qu'un héros est niveau 100).
  app.post(
    '/api/save/heritage',
    { preHandler: auth, config: { rateLimit: perUser(rateLimits.sensitive) } },
    async (request) => {
      const user = currentUser(request);
      if (multiplayer.isInCombat(user.id)) throw new HttpError(409, 'IN_MULTI_COMBAT');
      await performHeritage(prisma, await getSaveId(prisma, user.id));
      return loadSave(prisma, user.id);
    },
  );
}
