import type { PrismaClient } from '@prisma/client';
import { buyOfferBodySchema, itemIdBodySchema } from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId, loadSave } from '../save/service.ts';
import { buyOffer, getShop, sellItem } from './service.ts';

export async function shopRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const auth = requireUser(prisma);
  const options = { preHandler: auth, config: { rateLimit: perUser(rateLimits.sensitive) } };
  const saveOf = async (request: Parameters<typeof currentUser>[0]) => {
    const userId = currentUser(request).id;
    return { userId, saveId: await getSaveId(prisma, userId) };
  };

  app.get('/api/shop', { preHandler: auth }, async (request) => {
    const { saveId } = await saveOf(request);
    return getShop(prisma, saveId);
  });

  app.post('/api/shop/buy', options, async (request) => {
    const { offerId } = parseInput(buyOfferBodySchema, request.body);
    const { userId, saveId } = await saveOf(request);
    const shop = await buyOffer(prisma, saveId, offerId);
    return { shop, save: await loadSave(prisma, userId) };
  });

  app.post('/api/shop/sell', options, async (request) => {
    const { itemId } = parseInput(itemIdBodySchema, request.body);
    const { userId, saveId } = await saveOf(request);
    const gold = await sellItem(prisma, saveId, itemId);
    return { gold, save: await loadSave(prisma, userId) };
  });
}
