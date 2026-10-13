/**
 * Taverne côté serveur. L'assortiment est recalculé à partir d'une graine tirée par le serveur
 * à chaque nouvelle heure ; seules la graine, l'heure et les offres déjà achetées sont enregistrées.
 * Tous les prix sont recalculés ici : le client n'envoie que l'identifiant de l'offre.
 */
import { randomInt } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  generateShop,
  nextShopRefresh,
  sellPrice,
  shopPeriod,
  type ClassId,
  type ShopDto,
  type ShopOffers,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { createCharacter } from '../save/service.ts';
import { lockSave } from '../village/service.ts';

type Tx = Prisma.TransactionClient;

interface ShopState {
  offers: ShopOffers;
  purchases: string[];
  gold: bigint;
}

/** Assortiment courant ; à la première visite d'une nouvelle heure, une nouvelle graine est tirée. */
async function currentShop(
  tx: Tx,
  saveId: string,
  now: Date,
  forceNew = false,
): Promise<ShopState> {
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    include: { characters: { select: { class: true } }, buildings: true },
  });
  const period = shopPeriod(gameData, now);
  let { shopSeed: seed, shopPurchases: purchases } = save;
  if (forceNew || save.shopPeriod !== period) {
    seed = randomInt(0, 2 ** 31 - 1);
    purchases = [];
    await tx.save.update({
      where: { id: saveId },
      data: { shopSeed: seed, shopPeriod: period, shopPurchases: [] },
    });
  }
  const offers = generateShop(gameData, {
    seed,
    ownedClasses: save.characters.map((c) => c.class as ClassId),
    bestFloor: save.bestFloorEver,
    tavernLevel: save.buildings.find((b) => b.buildingId === 'taverne')?.level ?? 1,
  });
  return { offers, purchases, gold: save.gold };
}

function toDto(state: ShopState, now: Date): ShopDto {
  const available = <T extends { offerId: string }>(list: T[]) =>
    list.filter((o) => !state.purchases.includes(o.offerId));
  return {
    renewsAt: nextShopRefresh(gameData, now).toISOString(),
    discount: state.offers.discount,
    items: available(state.offers.items),
    lots: available(state.offers.lots),
    permanentLots: state.offers.permanentLots,
    characters: state.offers.characters,
  };
}

export async function getShop(
  prisma: PrismaClient,
  saveId: string,
  now = new Date(),
): Promise<ShopDto> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    return toDto(await currentShop(tx, saveId, now), now);
  });
}

/** Achète une offre : l'or est vérifié et débité, l'objet, les ressources ou le personnage ajoutés. */
export async function buyOffer(
  prisma: PrismaClient,
  saveId: string,
  offerId: string,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    const shop = await currentShop(tx, saveId, now);
    const { offers } = shop;
    const item = offers.items.find((o) => o.offerId === offerId);
    const lot = [...offers.lots, ...offers.permanentLots].find((o) => o.offerId === offerId);
    const character = offers.characters.find((o) => o.offerId === offerId);
    const offer = item ?? lot ?? character;
    // Les lots permanents (toile, verre, cuivre) s'achètent autant qu'on veut.
    const once = !offerId.startsWith('always-');
    if (!offer || (once && shop.purchases.includes(offerId)))
      throw new HttpError(409, 'OFFER_UNAVAILABLE');
    if (shop.gold < BigInt(offer.price)) throw new HttpError(409, 'NOT_ENOUGH_GOLD');

    await tx.save.update({
      where: { id: saveId },
      data: {
        gold: { decrement: BigInt(offer.price) },
        ...(once && !character ? { shopPurchases: { push: offerId } } : {}),
      },
    });
    if (item) {
      await tx.item.create({ data: { saveId, catalogId: item.catalogId } });
    } else if (lot) {
      await tx.resourceStock.upsert({
        where: { saveId_resourceId: { saveId, resourceId: lot.resourceId } },
        create: { saveId, resourceId: lot.resourceId, amount: lot.quantity },
        update: { amount: { increment: lot.quantity } },
      });
    } else if (character) {
      // Unicité de la classe garantie par l'offre et par la base (@@unique saveId + class).
      await createCharacter(tx, saveId, character.classId);
    }
    return toDto(await currentShop(tx, saveId, now), now);
  });
}

/** Revend un objet de l'inventaire (non équipé) : 20 % de son prix en boutique. */
export async function sellItem(
  prisma: PrismaClient,
  saveId: string,
  itemId: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    const item = await tx.item.findFirst({ where: { id: itemId, saveId } });
    if (!item) throw new HttpError(404, 'NOT_FOUND');
    if (item.equippedById) throw new HttpError(409, 'ITEM_EQUIPPED');
    const info = gameData.equipment.catalog.find((c) => c.id === item.catalogId);
    if (!info) throw new Error(`Objet inconnu : ${item.catalogId}`);
    const price = sellPrice(gameData, info, item.upgradeLevel);
    await tx.item.delete({ where: { id: itemId } });
    await tx.save.update({ where: { id: saveId }, data: { gold: { increment: BigInt(price) } } });
    return price;
  });
}

/** Debug : nouvel assortiment immédiat. */
export async function resetShop(
  prisma: PrismaClient,
  saveId: string,
  now = new Date(),
): Promise<ShopDto> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    return toDto(await currentShop(tx, saveId, now, true), now);
  });
}
