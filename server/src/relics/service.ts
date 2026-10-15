/**
 * Reliques et œufs de dragon (règles dans shared/src/rules/relics.ts) : butin des boss et des dragons
 * (une seule fois par compte), 6 emplacements pour toute l'équipe, sans doublon.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  RELIC_RULES,
  relicById,
  relicOfMonster,
  type CombatMode,
  type CombatState,
  type Rng,
} from '@la-tour/shared';
import { chance } from '@la-tour/shared';
import { HttpError } from '../http/errors.ts';
import { lockSave } from '../village/service.ts';

type Db = Prisma.TransactionClient | PrismaClient;

/** Reliques équipées d'une sauvegarde, dans l'ordre des emplacements. */
export async function equippedRelics(db: Db, saveId: string): Promise<string[]> {
  const rows = await db.relic.findMany({
    where: { saveId, slot: { not: null } },
    orderBy: { slot: 'asc' },
    select: { relicId: true },
  });
  return rows.map((r) => r.relicId);
}

/**
 * Butin de reliques d'un combat : chaque boss ou dragon vaincu a 5 % de chance de lâcher sa relique
 * (ou son œuf), si le joueur ne l'a pas encore. Jamais en zone de chasse. Renvoie les nouvelles.
 */
export async function grantRelics(
  tx: Prisma.TransactionClient,
  saveId: string,
  rng: Rng,
  killed: CombatState['killed'],
  mode: CombatMode,
): Promise<string[]> {
  if (mode === 'hunt') return [];
  const owned = new Set(
    (await tx.relic.findMany({ where: { saveId }, select: { relicId: true } })).map(
      (r) => r.relicId,
    ),
  );
  const gained: string[] = [];
  for (const { monsterId } of killed) {
    const relic = relicOfMonster(monsterId);
    if (!relic || owned.has(relic.id)) continue;
    if (!chance(rng, RELIC_RULES.dropChance)) continue;
    await tx.relic.create({ data: { saveId, relicId: relic.id } });
    owned.add(relic.id);
    gained.push(relic.id);
  }
  return gained;
}

/** Équipe une relique possédée ; celle qui occupait l'emplacement retourne dans l'inventaire. */
export async function equipRelic(
  prisma: PrismaClient,
  saveId: string,
  relicId: string,
  slot: number,
): Promise<void> {
  if (!relicById(relicId)) throw new HttpError(404, 'NOT_FOUND');
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    await assertNoCombat(tx, saveId);
    const relic = await tx.relic.findUnique({ where: { saveId_relicId: { saveId, relicId } } });
    if (!relic) throw new HttpError(404, 'NOT_FOUND');
    if (relic.slot === slot) return;
    await tx.relic.updateMany({ where: { saveId, slot }, data: { slot: null } });
    await tx.relic.update({ where: { saveId_relicId: { saveId, relicId } }, data: { slot } });
  });
}

export async function unequipRelic(
  prisma: PrismaClient,
  saveId: string,
  relicId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    await assertNoCombat(tx, saveId);
    const { count } = await tx.relic.updateMany({
      where: { saveId, relicId },
      data: { slot: null },
    });
    if (count === 0) throw new HttpError(404, 'NOT_FOUND');
  });
}

/** Les reliques ne changent pas pendant un combat (leurs effets sont fixés au début). */
async function assertNoCombat(tx: Prisma.TransactionClient, saveId: string): Promise<void> {
  if (await tx.combatSession.findUnique({ where: { saveId }, select: { saveId: true } }))
    throw new HttpError(409, 'COMBAT_IN_PROGRESS');
}
