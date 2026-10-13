/** Personnages : répartition des points de statistiques (vérifiée par le serveur). */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  addStatPoints,
  allocateStatPointsBodySchema,
  characterIdBodySchema,
  emptyAllocation,
  toAllocation,
} from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, requireUser } from '../auth/guards.ts';
import { HttpError, parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { getSaveId, loadSave } from '../save/service.ts';
import { lockSave } from '../village/service.ts';

export async function characterRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const options = {
    preHandler: requireUser(prisma),
    config: { rateLimit: perUser(rateLimits.sensitive) },
  };

  const ownCharacter = async (
    tx: Prisma.TransactionClient,
    saveId: string,
    characterId: string,
  ) => {
    const character = await tx.character.findFirst({ where: { id: characterId, saveId } });
    if (!character) throw new HttpError(404, 'NOT_FOUND');
    return character;
  };

  app.post('/api/characters/stats', options, async (request) => {
    const { characterId, add } = parseInput(allocateStatPointsBodySchema, request.body);
    const userId = currentUser(request).id;
    const saveId = await getSaveId(prisma, userId);
    await prisma.$transaction(async (tx) => {
      await lockSave(tx, saveId);
      const character = await ownCharacter(tx, saveId, characterId);
      const next = addStatPoints(character.level, toAllocation(character.statPoints), add);
      if (!next) throw new HttpError(409, 'NOT_ENOUGH_POINTS');
      await tx.character.update({ where: { id: characterId }, data: { statPoints: next } });
    });
    return loadSave(prisma, userId);
  });

  // Réinitialisation gratuite des points.
  app.post('/api/characters/stats/reset', options, async (request) => {
    const { characterId } = parseInput(characterIdBodySchema, request.body);
    const userId = currentUser(request).id;
    const saveId = await getSaveId(prisma, userId);
    await prisma.$transaction(async (tx) => {
      await lockSave(tx, saveId);
      await ownCharacter(tx, saveId, characterId);
      await tx.character.update({
        where: { id: characterId },
        data: { statPoints: emptyAllocation() },
      });
    });
    return loadSave(prisma, userId);
  });
}
