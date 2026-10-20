/**
 * Inventaire, équipement et Atelier. Le serveur vérifie l'appartenance de l'objet et du personnage,
 * la classe, le palier ouvert par l'Atelier et les ressources, puis écrit tout en une transaction.
 */
import { randomInt } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  craftCost,
  createRng,
  evolutionTier,
  hasThirdWeapon,
  itemWorkTier,
  rollCraftRarity,
  workshopMaxTier,
  workshopUpgradeCost,
  type CraftItemBody,
  type UpgradeCost,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { collectIdle, lockSave } from '../village/service.ts';

type Tx = Prisma.TransactionClient;

const WORKSHOP = 'atelier_fabrication';

function catalogItem(catalogId: string) {
  const item = gameData.equipment.catalog.find((c) => c.id === catalogId);
  if (!item) throw new Error(`Objet inconnu : ${catalogId}`);
  return item;
}

async function ownedItem(tx: Tx, saveId: string, itemId: string) {
  const item = await tx.item.findFirst({ where: { id: itemId, saveId } });
  if (!item) throw new HttpError(404, 'NOT_FOUND');
  return item;
}

/**
 * Équipe un objet sur un personnage ; l'objet déjà porté dans ce slot retourne dans l'inventaire.
 * `slot` = weapon3 : 3e arme du Maître d'armes (une épée ou un bouclier).
 */
export async function equipItem(
  prisma: PrismaClient,
  saveId: string,
  itemId: string,
  characterId: string,
  slot?: 'weapon3',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    const item = await ownedItem(tx, saveId, itemId);
    const character = await tx.character.findFirst({ where: { id: characterId, saveId } });
    if (!character) throw new HttpError(404, 'NOT_FOUND');
    const info = catalogItem(item.catalogId);
    if (info.classId !== character.class) throw new HttpError(409, 'WRONG_CLASS');
    let target: typeof item.equippedSlot = info.slot;
    if (slot === 'weapon3') {
      const save = await tx.save.findUniqueOrThrow({
        where: { id: saveId },
        select: { heritageCount: true },
      });
      if (!hasThirdWeapon(character.class, evolutionTier(save.heritageCount)))
        throw new HttpError(409, 'SLOT_LOCKED');
      if (info.slot !== 'weapon1' && info.slot !== 'weapon2')
        throw new HttpError(409, 'WRONG_SLOT');
      target = 'weapon3';
    }

    await tx.item.updateMany({
      where: { equippedById: characterId, equippedSlot: target, NOT: { id: itemId } },
      data: { equippedById: null, equippedSlot: null },
    });
    await tx.item.update({
      where: { id: itemId },
      data: { equippedById: characterId, equippedSlot: target },
    });
  });
}

export async function unequipItem(
  prisma: PrismaClient,
  saveId: string,
  itemId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    await ownedItem(tx, saveId, itemId);
    await tx.item.update({
      where: { id: itemId },
      data: { equippedById: null, equippedSlot: null },
    });
  });
}

/** Niveau de l'Atelier (erreur s'il n'est pas encore construit). */
async function workshopLevel(tx: Tx, saveId: string): Promise<number> {
  const building = await tx.building.findUnique({
    where: { saveId_buildingId: { saveId, buildingId: WORKSHOP } },
  });
  if (!building) throw new HttpError(409, 'BUILDING_LOCKED');
  return building.level;
}

/** Débite une ressource après avoir vérifié le stock. */
async function spend(tx: Tx, saveId: string, cost: UpgradeCost): Promise<void> {
  const stock = await tx.resourceStock.findUnique({
    where: { saveId_resourceId: { saveId, resourceId: cost.resourceId } },
  });
  const owned = stock?.amount ?? 0;
  if (owned < cost.quantity) {
    throw new HttpError(409, 'NOT_ENOUGH_RESOURCES', {
      resourceId: cost.resourceId,
      missing: cost.quantity - owned,
    });
  }
  await tx.resourceStock.update({
    where: { saveId_resourceId: { saveId, resourceId: cost.resourceId } },
    data: { amount: { decrement: cost.quantity } },
  });
}

/** Améliore un objet d'un niveau à l'Atelier, avec le matériau de l'objet. Instantané. */
export async function upgradeItem(
  prisma: PrismaClient,
  saveId: string,
  itemId: string,
  now = new Date(),
) {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    await collectIdle(tx, saveId, now);
    const level = await workshopLevel(tx, saveId);
    const item = await ownedItem(tx, saveId, itemId);
    const info = catalogItem(item.catalogId);
    const cost = workshopUpgradeCost(gameData.equipment, info, item.upgradeLevel, level);
    if (!cost) throw new HttpError(409, 'ITEM_MAX_LEVEL');
    const tier = itemWorkTier(gameData.equipment, info, item.upgradeLevel);
    if (tier > workshopMaxTier(level)) throw new HttpError(409, 'TIER_LOCKED', { tier });
    await spend(tx, saveId, cost);
    await tx.item.update({ where: { id: itemId }, data: { upgradeLevel: { increment: 1 } } });
  });
}

/**
 * Fabrique un objet +0 pour une classe de l'équipe, dans un palier ouvert par l'Atelier.
 * Il coûte le prix de sa version Commune ; sa rareté est tirée selon le niveau de l'Atelier.
 */
export async function craftItem(
  prisma: PrismaClient,
  saveId: string,
  request: CraftItemBody,
  now = new Date(),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    await collectIdle(tx, saveId, now);
    const level = await workshopLevel(tx, saveId);
    if (request.tier > workshopMaxTier(level))
      throw new HttpError(409, 'TIER_LOCKED', { tier: request.tier });
    const owned = await tx.character.findFirst({ where: { saveId, class: request.classId } });
    if (!owned) throw new HttpError(409, 'CLASS_NOT_OWNED');
    const find = (rarity: string) =>
      gameData.equipment.catalog.find(
        (c) =>
          c.classId === request.classId &&
          c.slot === request.slot &&
          c.tier === request.tier &&
          c.rarity === rarity,
      );
    const common = find('common');
    if (!common) throw new HttpError(404, 'NOT_FOUND');
    await spend(tx, saveId, craftCost(gameData, common));
    const rarity = rollCraftRarity(createRng(randomInt(0, 2 ** 32 - 1)), level);
    const info = find(rarity) ?? common;
    const item = await tx.item.create({ data: { saveId, catalogId: info.id } });
    return item.id;
  });
}
