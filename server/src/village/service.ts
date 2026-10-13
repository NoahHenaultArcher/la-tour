/**
 * Village côté serveur : collecte de la production idle et amélioration des bâtiments.
 * Le temps vient toujours de l'horloge du serveur ; chaque opération verrouille la sauvegarde
 * (SELECT … FOR UPDATE) pour qu'une double requête ne puisse ni collecter ni dépenser deux fois.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  canAfford,
  computeIdleProduction,
  nextBuildingUpgrade,
  upgradeShortfall,
  villageIdleSettings,
  type IdleReport,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';

const HOUR_MS = 3_600_000;

/** Verrouille la ligne de la sauvegarde jusqu'à la fin de la transaction. */
export async function lockSave(tx: Prisma.TransactionClient, saveId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Save" WHERE id = ${saveId}::uuid FOR UPDATE`;
}

/** Ajoute la production depuis la dernière collecte aux stocks (à appeler dans une transaction verrouillée). */
export async function collectIdle(
  tx: Prisma.TransactionClient,
  saveId: string,
  now: Date,
): Promise<IdleReport> {
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    include: { buildings: true, resources: true, upgradeTower: true },
  });
  const settings = villageIdleSettings(
    gameData.village,
    Object.fromEntries(save.buildings.map((b) => [b.buildingId, b.level])),
    Object.fromEntries(save.upgradeTower.map((t) => [t.branch as UpgradeTowerBranchId, t.level])),
  );
  const result = computeIdleProduction({
    now,
    lastCollectedAt: save.lastIdleCollectAt,
    ratesPerHour: settings.ratesPerHour,
    stocks: Object.fromEntries(
      save.resources.map((r) => [r.resourceId, { amount: r.amount, fraction: r.fraction }]),
    ),
    capacity: settings.capacity,
    maxHours: settings.maxHours,
    productionBonus: settings.productionBonus,
  });

  for (const resourceId of Object.keys(settings.ratesPerHour)) {
    const stock = result.stocks[resourceId]!;
    await tx.resourceStock.upsert({
      where: { saveId_resourceId: { saveId, resourceId } },
      create: { saveId, resourceId, amount: stock.amount, fraction: stock.fraction },
      update: { amount: stock.amount, fraction: stock.fraction },
    });
  }
  await tx.save.update({ where: { id: saveId }, data: { lastIdleCollectAt: now } });

  return {
    elapsedHours: Math.max(0, (now.getTime() - save.lastIdleCollectAt.getTime()) / HOUR_MS),
    countedHours: result.hours,
    produced: Object.fromEntries(Object.entries(result.produced).filter(([, n]) => n > 0)),
    full: Object.keys(settings.ratesPerHour).filter(
      (id) => result.stocks[id]!.amount >= settings.capacity,
    ),
  };
}

export async function collectIdleFor(
  prisma: PrismaClient,
  saveId: string,
  now = new Date(),
): Promise<IdleReport> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    return collectIdle(tx, saveId, now);
  });
}

/**
 * Améliore un bâtiment d'un niveau. Le serveur calcule lui-même le niveau visé et le coût,
 * vérifie l'étage terminé, l'or et les matériaux, puis débite tout en une seule transaction.
 */
export async function upgradeBuilding(
  prisma: PrismaClient,
  saveId: string,
  buildingId: string,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    // La production en cours compte avant de payer (et la production suit ensuite le nouveau niveau).
    await collectIdle(tx, saveId, now);

    const building = await tx.building.findUnique({
      where: { saveId_buildingId: { saveId, buildingId } },
    });
    if (!building) {
      const exists = gameData.village.buildings.some((b) => b.id === buildingId);
      throw new HttpError(exists ? 409 : 404, exists ? 'BUILDING_LOCKED' : 'NOT_FOUND');
    }
    const info = gameData.village.buildings.find((b) => b.id === buildingId)!;
    const next = nextBuildingUpgrade(gameData.village, buildingId, building.level);
    if (!next) {
      const upgradable = gameData.village.upgrades.some((u) => u.buildingId === buildingId);
      throw new HttpError(
        409,
        upgradable && info.maxLevel !== null ? 'MAX_LEVEL' : 'NOT_UPGRADABLE',
      );
    }

    const save = await tx.save.findUniqueOrThrow({
      where: { id: saveId },
      include: { resources: true },
    });
    const resources = Object.fromEntries(save.resources.map((r) => [r.resourceId, r.amount]));
    const shortfall = upgradeShortfall(next.cost, {
      gold: Number(save.gold),
      resources,
      floorCleared: save.bestFloorEver,
    });
    if (shortfall.floor) {
      throw new HttpError(409, 'FLOOR_REQUIRED', { requiredFloor: next.cost.requiredFloor });
    }
    if (!canAfford(shortfall)) throw new HttpError(409, 'NOT_ENOUGH_RESOURCES', shortfall);

    const { cost } = next;
    await tx.save.update({
      where: { id: saveId },
      data: { gold: { decrement: BigInt(cost.gold) } },
    });
    const spend: [string, number][] = [
      [cost.material, cost.quantity],
      ['charbon', cost.coal],
    ];
    for (const [resourceId, amount] of spend) {
      if (amount === 0) continue;
      await tx.resourceStock.update({
        where: { saveId_resourceId: { saveId, resourceId } },
        data: { amount: { decrement: amount } },
      });
    }
    await tx.building.update({
      where: { saveId_buildingId: { saveId, buildingId } },
      data: { level: cost.targetLevel },
    });
  });
}
