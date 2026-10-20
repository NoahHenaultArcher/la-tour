import type { PrismaClient } from '@prisma/client';
import { craftItemBodySchema, equipItemBodySchema, itemIdBodySchema } from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId, loadSave } from '../save/service.ts';
import { craftItem, equipItem, unequipItem, upgradeItem } from './service.ts';

export async function itemRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const options = {
    preHandler: requireUser(prisma),
    config: { rateLimit: perUser(rateLimits.sensitive) },
  };

  /** Déclare une action sur la sauvegarde : valide, applique, renvoie la sauvegarde à jour. */
  const route = <T>(
    path: string,
    parse: (body: unknown) => T,
    apply: (saveId: string, input: T) => Promise<unknown>,
  ) => {
    app.post(path, options, async (request) => {
      const input = parse(request.body);
      const userId = currentUser(request).id;
      await apply(await getSaveId(prisma, userId), input);
      return loadSave(prisma, userId);
    });
  };

  route(
    '/api/items/equip',
    (body) => parseInput(equipItemBodySchema, body),
    (saveId, { itemId, characterId, slot }) => equipItem(prisma, saveId, itemId, characterId, slot),
  );
  route(
    '/api/items/unequip',
    (body) => parseInput(itemIdBodySchema, body),
    (saveId, { itemId }) => unequipItem(prisma, saveId, itemId),
  );
  route(
    '/api/workshop/upgrade',
    (body) => parseInput(itemIdBodySchema, body),
    (saveId, { itemId }) => upgradeItem(prisma, saveId, itemId),
  );
  route(
    '/api/workshop/craft',
    (body) => parseInput(craftItemBodySchema, body),
    (saveId, input) => craftItem(prisma, saveId, input),
  );
}
