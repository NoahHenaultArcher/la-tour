/**
 * Outils de debug (panneau ouvert par `debug.enable()` dans la console du navigateur).
 * Chaque route exige un compte admin en base. Ces routes ne sont pas enregistrées en production.
 * Elles agissent sur la sauvegarde du compte admin connecté et renvoient la sauvegarde à jour.
 */
import type { PrismaClient } from '@prisma/client';
import {
  ELEMENT_IDS,
  addXp,
  clampUpgrade,
  debugAdvanceIdleSchema,
  debugCreateItemSchema,
  debugGiveGoldSchema,
  debugGiveResourcesSchema,
  debugGiveXpSchema,
  debugGiveRelicSchema,
  debugGoToAbyssSchema,
  debugGoToFloorSchema,
  debugSetLevelSchema,
  debugUnlockElementSchema,
  RELIC_IDS,
  TOWER_FLOORS,
  winCurrentWave,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAdmin, requireUser } from '../auth/guards.ts';
import { playCombat } from '../combat/service.ts';
import { resetShop } from '../shop/service.ts';
import { HttpError, parseInput } from '../http/errors.ts';
import { perUser, type RateLimits } from '../http/rate-limits.ts';
import { applyTowerProgress, getSaveId, loadSave } from '../save/service.ts';

export async function debugRoutes(
  app: FastifyInstance,
  { prisma, rateLimits }: { prisma: PrismaClient; rateLimits: RateLimits },
): Promise<void> {
  const options = {
    preHandler: [requireUser(prisma), requireAdmin],
    config: { rateLimit: perUser(rateLimits.sensitive) },
  };

  /** Déclare une action : valide l'entrée, l'applique en transaction, renvoie la sauvegarde. */
  const action = <T extends z.ZodType>(
    path: string,
    schema: T,
    apply: (input: z.infer<T>, saveId: string, request: FastifyRequest) => Promise<void>,
  ) => {
    app.post(`/api/debug/${path}`, options, async (request) => {
      const input = parseInput(schema, request.body);
      const userId = currentUser(request).id;
      await apply(input, await getSaveId(prisma, userId), request);
      return loadSave(prisma, userId);
    });
  };

  // Gagner la vague en cours : tous les monstres de la vague sont vaincus (récompenses comprises).
  app.post('/api/debug/win-wave', options, async (request) => {
    const userId = currentUser(request).id;
    return playCombat(prisma, userId, await getSaveId(prisma, userId), (state) =>
      winCurrentWave(gameData, state),
    );
  });

  // Réinitialiser la boutique : nouvel assortiment immédiat.
  app.post('/api/debug/reset-shop', options, async (request) => {
    const userId = currentUser(request).id;
    return resetShop(prisma, await getSaveId(prisma, userId));
  });

  const ownCharacter = async (saveId: string, characterId: string) => {
    const character = await prisma.character.findFirst({ where: { id: characterId, saveId } });
    if (!character) throw new HttpError(404, 'NOT_FOUND');
    return character;
  };

  action('gold', debugGiveGoldSchema, async ({ amount }, saveId) => {
    await prisma.save.update({
      where: { id: saveId },
      data: { gold: { increment: BigInt(amount) } },
    });
  });

  action('resources', debugGiveResourcesSchema, async ({ resourceId, amount }, saveId) => {
    const ids = resourceId === 'all' ? gameData.resources.resources.map((r) => r.id) : [resourceId];
    if (!ids.every((id) => gameData.resources.resources.some((r) => r.id === id))) {
      throw new HttpError(400, 'VALIDATION', { resourceId: ['Ressource inconnue'] });
    }
    await prisma.$transaction(
      ids.map((id) =>
        prisma.resourceStock.upsert({
          where: { saveId_resourceId: { saveId, resourceId: id } },
          create: { saveId, resourceId: id, amount },
          update: { amount: { increment: amount } },
        }),
      ),
    );
  });

  action('xp', debugGiveXpSchema, async ({ characterId, amount }, saveId) => {
    const character = await ownCharacter(saveId, characterId);
    const { level, xp } = addXp(gameData.monsters, character, amount);
    await prisma.character.update({
      where: { id: character.id },
      data: { level, xp, bestLevel: Math.max(character.bestLevel, level) },
    });
  });

  action('level', debugSetLevelSchema, async ({ characterId, level }, saveId) => {
    const character = await ownCharacter(saveId, characterId);
    await prisma.character.update({
      where: { id: character.id },
      data: { level, xp: 0, bestLevel: Math.max(character.bestLevel, level) },
    });
  });

  // Aller à un étage : tous les étages précédents sont considérés comme terminés.
  action('floor', debugGoToFloorSchema, async ({ floor }, saveId) => {
    await prisma.$transaction((tx) =>
      applyTowerProgress(tx, saveId, { currentFloor: floor, highestFloorCleared: floor - 1 }),
    );
  });

  action('unlock-tower', z.strictObject({}), async (_input, saveId) => {
    await prisma.$transaction((tx) =>
      applyTowerProgress(tx, saveId, {
        currentFloor: TOWER_FLOORS,
        highestFloorCleared: TOWER_FLOORS,
      }),
    );
  });

  // Reliques : une précise, ou « all » pour toutes (celles déjà possédées sont ignorées).
  action('relic', debugGiveRelicSchema, async ({ relicId }, saveId) => {
    const ids = relicId === 'all' ? RELIC_IDS : [relicId];
    if (!ids.every((id) => RELIC_IDS.includes(id))) throw new HttpError(400, 'VALIDATION');
    await prisma.relic.createMany({
      data: ids.map((id) => ({ saveId, relicId: id })),
      skipDuplicates: true,
    });
  });

  // Abysse : ouvre la tour en entier si besoin, puis place le joueur à cet étage de l'Abysse.
  action('abyss', debugGoToAbyssSchema, async ({ floor }, saveId) => {
    await prisma.$transaction(async (tx) => {
      const save = await tx.save.findUniqueOrThrow({
        where: { id: saveId },
        select: { highestFloorCleared: true, bestAbyssFloor: true },
      });
      if (save.highestFloorCleared < TOWER_FLOORS)
        await applyTowerProgress(tx, saveId, {
          currentFloor: TOWER_FLOORS,
          highestFloorCleared: TOWER_FLOORS,
        });
      await tx.save.update({
        where: { id: saveId },
        data: {
          abyssFloor: floor,
          abyssCleared: floor - 1,
          bestAbyssFloor: Math.max(save.bestAbyssFloor, floor - 1),
        },
      });
    });
  });

  action('element', debugUnlockElementSchema, async ({ element }, saveId) => {
    const save = await prisma.save.findUniqueOrThrow({
      where: { id: saveId },
      select: { unlockedElements: true },
    });
    const unlocked = new Set([...save.unlockedElements, element]);
    await prisma.save.update({
      where: { id: saveId },
      data: { unlockedElements: ELEMENT_IDS.filter((id) => unlocked.has(id)) },
    });
  });

  action(
    'item',
    debugCreateItemSchema,
    async ({ classId, slot, rarity, tier, upgradeLevel }, saveId) => {
      const item = gameData.equipment.catalog.find(
        (c) =>
          c.classId === classId &&
          c.slot === slot &&
          c.rarity === rarity &&
          (rarity === 'unique' || c.tier === tier),
      );
      if (!item) throw new HttpError(404, 'NOT_FOUND');
      await prisma.item.create({
        data: { saveId, catalogId: item.id, upgradeLevel: clampUpgrade(item, upgradeLevel) },
      });
    },
  );

  // Avancer l'horloge idle : recule la date de dernière collecte (la production sera calculée en phase 3).
  action('idle', debugAdvanceIdleSchema, async ({ hours }, saveId) => {
    const save = await prisma.save.findUniqueOrThrow({
      where: { id: saveId },
      select: { lastIdleCollectAt: true },
    });
    await prisma.save.update({
      where: { id: saveId },
      data: { lastIdleCollectAt: new Date(save.lastIdleCollectAt.getTime() - hours * 3_600_000) },
    });
  });
}
