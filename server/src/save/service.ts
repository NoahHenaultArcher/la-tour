/**
 * Sauvegarde du joueur : création, lecture, choix de la classe et déblocages liés à l'étage.
 * Toutes les écritures passent par des transactions : tout ou rien.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  availableStatPoints,
  starterDeckFor,
  toAllocation,
  totalStatPoints,
  unlockedBuildings,
  unlockedElements,
  xpToNextLevel,
  type ClassId,
  type ElementId,
  type SaveDto,
  type SlotId,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { collectIdle, lockSave } from '../village/service.ts';

type Db = PrismaClient | Prisma.TransactionClient;

/** Sauvegarde vierge : bâtiments de départ niveau 1, élément Neutre, aucun personnage. */
export async function createInitialSave(tx: Db, userId: string): Promise<string> {
  const save = await tx.save.create({
    data: {
      userId,
      unlockedElements: unlockedElements(gameData.elements, 0),
      buildings: {
        create: unlockedBuildings(gameData.village, 0).map((buildingId) => ({
          buildingId,
          level: 1,
        })),
      },
    },
  });
  return save.id;
}

export async function getSaveId(db: Db, userId: string): Promise<string> {
  const save = await db.save.findUnique({ where: { userId }, select: { id: true } });
  if (!save) throw new HttpError(404, 'NOT_FOUND');
  return save.id;
}

/** État complet de la sauvegarde envoyé au client. */
export async function loadSave(db: Db, userId: string): Promise<SaveDto> {
  const save = await db.save.findUnique({
    where: { userId },
    include: {
      characters: {
        include: { skills: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      },
      items: { orderBy: { acquiredAt: 'asc' } },
      resources: true,
      buildings: true,
      upgradeTower: true,
    },
  });
  if (!save) throw new HttpError(404, 'NOT_FOUND');
  return {
    gold: Number(save.gold),
    currentFloor: save.currentFloor,
    highestFloorCleared: save.highestFloorCleared,
    bestFloorEver: save.bestFloorEver,
    heritageCount: save.heritageCount,
    unlockedElements: save.unlockedElements as ElementId[],
    lastIdleCollectAt: save.lastIdleCollectAt.toISOString(),
    characters: save.characters.map((c) => ({
      id: c.id,
      classId: c.class,
      level: c.level,
      xp: c.xp,
      xpToNextLevel: xpToNextLevel(gameData.monsters, c.level),
      statPoints: {
        allocated: toAllocation(c.statPoints),
        available: availableStatPoints(c.level, toAllocation(c.statPoints)),
        total: totalStatPoints(c.level),
      },
      skills: c.skills.map((s) => ({
        position: s.position,
        skillId: s.skillId,
        fusionElement: s.fusionElement as ElementId | null,
      })),
    })),
    items: save.items.map((i) => ({
      id: i.id,
      catalogId: i.catalogId,
      upgradeLevel: i.upgradeLevel,
      equippedBy: i.equippedById,
      slot: i.equippedSlot as SlotId | null,
    })),
    resources: Object.fromEntries(save.resources.map((r) => [r.resourceId, r.amount])),
    buildings: Object.fromEntries(save.buildings.map((b) => [b.buildingId, b.level])),
    upgradeTower: Object.fromEntries(
      save.upgradeTower.map((t) => [t.branch as UpgradeTowerBranchId, t.level]),
    ),
    updatedAt: save.updatedAt.toISOString(),
    serverTime: new Date().toISOString(),
  };
}

/** Première connexion : crée le personnage de la classe choisie, au niveau 1, avec son kit. */
export async function chooseStartingClass(
  prisma: PrismaClient,
  userId: string,
  classId: ClassId,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const save = await tx.save.findUnique({
      where: { userId },
      select: { id: true, _count: { select: { characters: true } } },
    });
    if (!save) throw new HttpError(404, 'NOT_FOUND');
    if (save._count.characters > 0) throw new HttpError(409, 'CLASS_ALREADY_CHOSEN');
    await createCharacter(tx, save.id, classId);
  });
}

/** Nouveau personnage : niveau 1, kit de départ de sa classe (choix initial ou achat à la taverne). */
export async function createCharacter(tx: Db, saveId: string, classId: ClassId): Promise<void> {
  await tx.character.create({
    data: { saveId, class: classId, skills: { create: starterDeckFor(gameData, classId) } },
  });
}

/**
 * Applique la progression de la tour : étage courant, plus haut étage terminé,
 * éléments débloqués (conservés) et bâtiments débloqués par le meilleur étage atteint.
 */
export async function applyTowerProgress(
  tx: Prisma.TransactionClient,
  saveId: string,
  progress: { currentFloor: number; highestFloorCleared: number },
): Promise<void> {
  // Un bâtiment qui se débloque ne produit qu'à partir de maintenant : on collecte d'abord.
  await lockSave(tx, saveId);
  await collectIdle(tx, saveId, new Date());
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    select: { bestFloorEver: true, unlockedElements: true },
  });
  const bestFloorEver = Math.max(save.bestFloorEver, progress.highestFloorCleared);
  const elements = new Set([
    ...save.unlockedElements,
    ...unlockedElements(gameData.elements, progress.highestFloorCleared),
  ]);
  await tx.save.update({
    where: { id: saveId },
    data: {
      currentFloor: progress.currentFloor,
      highestFloorCleared: progress.highestFloorCleared,
      bestFloorEver,
      unlockedElements: gameData.elements.elements
        .map((e) => e.id)
        .filter((id) => elements.has(id)),
    },
  });
  await tx.building.createMany({
    data: unlockedBuildings(gameData.village, bestFloorEver).map((buildingId) => ({
      saveId,
      buildingId,
      level: 1,
    })),
    skipDuplicates: true,
  });
}
