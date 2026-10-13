import type { PrismaClient } from '@prisma/client';
import {
  combatActionBodySchema,
  endHeroTurn,
  forfeitCombat,
  performHeroAction,
  playAutoTurn,
  retreatFromHunt,
  startCombatBodySchema,
  startHuntBodySchema,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId } from '../save/service.ts';
import { getCombat, playCombat, startCombat } from './service.ts';

export async function combatRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const auth = requireUser(prisma);
  const options = { preHandler: auth, config: { rateLimit: perUser(rateLimits.combat) } };
  const ids = async (request: Parameters<typeof currentUser>[0]) => {
    const userId = currentUser(request).id;
    return { userId, saveId: await getSaveId(prisma, userId) };
  };

  app.get('/api/combat', { preHandler: auth }, async (request) => {
    const { saveId } = await ids(request);
    return getCombat(prisma, saveId);
  });

  app.post('/api/combat/start', options, async (request) => {
    const { floor } = parseInput(startCombatBodySchema, request.body);
    const { saveId } = await ids(request);
    return startCombat(prisma, saveId, floor);
  });

  app.post('/api/combat/action', options, async (request) => {
    const action = parseInput(combatActionBodySchema, request.body);
    const { userId, saveId } = await ids(request);
    return playCombat(prisma, userId, saveId, (state) =>
      performHeroAction(gameData, state, action),
    );
  });

  app.post('/api/combat/pass', options, async (request) => {
    const { userId, saveId } = await ids(request);
    return playCombat(prisma, userId, saveId, (state) => endHeroTurn(gameData, state));
  });

  // Mode auto (solo) : l'IA joue les actions restantes du tour.
  app.post('/api/combat/auto', options, async (request) => {
    const { userId, saveId } = await ids(request);
    return playCombat(prisma, userId, saveId, (state) => playAutoTurn(gameData, state));
  });

  // Zone de chasse débloquée : vagues sans fin, jusqu'à ce que le joueur parte (ou tombe).
  app.post('/api/combat/hunt', options, async (request) => {
    const { zoneFloor } = parseInput(startHuntBodySchema, request.body);
    const { saveId } = await ids(request);
    return startCombat(prisma, saveId, zoneFloor, 'hunt');
  });

  app.post('/api/combat/retreat', options, async (request) => {
    const { userId, saveId } = await ids(request);
    return playCombat(prisma, userId, saveId, (state) => retreatFromHunt(gameData, state));
  });

  app.post('/api/combat/forfeit', options, async (request) => {
    const { userId, saveId } = await ids(request);
    return playCombat(prisma, userId, saveId, (state) => forfeitCombat(gameData, state));
  });
}
