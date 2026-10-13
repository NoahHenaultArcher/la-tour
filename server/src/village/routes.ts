import type { PrismaClient } from '@prisma/client';
import {
  upgradeBuildingBodySchema,
  upgradeTowerBranchBodySchema,
  type CollectResponse,
} from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId, loadSave } from '../save/service.ts';
import { collectIdleFor, upgradeBuilding, upgradeTowerBranch } from './service.ts';

export async function villageRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const options = {
    preHandler: requireUser(prisma),
    config: { rateLimit: perUser(rateLimits.sensitive) },
  };

  // Collecte la production idle (à la connexion, puis régulièrement tant que le joueur est en ligne).
  app.post('/api/village/collect', options, async (request): Promise<CollectResponse> => {
    const userId = currentUser(request).id;
    const report = await collectIdleFor(prisma, await getSaveId(prisma, userId));
    return { save: await loadSave(prisma, userId), report };
  });

  app.post('/api/village/upgrade', options, async (request) => {
    const { buildingId } = parseInput(upgradeBuildingBodySchema, request.body);
    const userId = currentUser(request).id;
    await upgradeBuilding(prisma, await getSaveId(prisma, userId), buildingId);
    return loadSave(prisma, userId);
  });

  // Tour d'amélioration : une branche monte d'un niveau.
  app.post('/api/village/upgrade-tower', options, async (request) => {
    const { branch } = parseInput(upgradeTowerBranchBodySchema, request.body);
    const userId = currentUser(request).id;
    await upgradeTowerBranch(prisma, await getSaveId(prisma, userId), branch);
    return loadSave(prisma, userId);
  });
}
