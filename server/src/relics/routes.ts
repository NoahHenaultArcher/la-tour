import type { PrismaClient } from '@prisma/client';
import { equipRelicBodySchema, unequipRelicBodySchema } from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId, loadSave } from '../save/service.ts';
import { equipRelic, unequipRelic } from './service.ts';

export async function relicRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const options = {
    preHandler: requireUser(prisma),
    config: { rateLimit: perUser(rateLimits.sensitive) },
  };

  app.post('/api/relics/equip', options, async (request) => {
    const { relicId, slot } = parseInput(equipRelicBodySchema, request.body);
    const userId = currentUser(request).id;
    await equipRelic(prisma, await getSaveId(prisma, userId), relicId, slot);
    return loadSave(prisma, userId);
  });

  app.post('/api/relics/unequip', options, async (request) => {
    const { relicId } = parseInput(unequipRelicBodySchema, request.body);
    const userId = currentUser(request).id;
    await unequipRelic(prisma, await getSaveId(prisma, userId), relicId);
    return loadSave(prisma, userId);
  });
}
