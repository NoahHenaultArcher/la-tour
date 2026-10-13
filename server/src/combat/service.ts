/**
 * Combats côté serveur. Le moteur (@la-tour/shared) calcule tout ; le serveur charge l'état,
 * valide l'intention du joueur, applique le moteur et enregistre, dans une transaction verrouillée.
 * À la fin du combat : or, XP (montées de niveau) et progression de la tour, en une seule fois.
 */
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { type PrismaClient } from '@prisma/client';
import {
  CombatError,
  TOWER_FLOORS,
  addXp,
  canPlayFloor,
  combatRewards,
  createCombat,
  itemStats,
  rollLoot,
  toAllocation,
  toCombatView,
  unlockedBuildings,
  unlockedElements,
  unlockedHuntingZones,
  upgradeTowerBonus,
  type CombatMode,
  type CombatOutcome,
  type CombatResponse,
  type CombatResult,
  type CombatState,
  type ElementId,
  type HeroSetup,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { applyTowerProgress, loadSave } from '../save/service.ts';
import { lockSave } from '../village/service.ts';

type Tx = Prisma.TransactionClient;

function towerLevels(rows: { branch: string; level: number }[]) {
  return Object.fromEntries(rows.map((t) => [t.branch as UpgradeTowerBranchId, t.level]));
}

/** Équipe d'une sauvegarde : tous les personnages (1 à 3), avec équipement et deck. */
async function loadTeam(tx: Tx, saveId: string): Promise<HeroSetup[]> {
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    include: {
      characters: { include: { skills: true, equipment: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  return save.characters.map((c) => ({
    characterId: c.id,
    classId: c.class,
    level: c.level,
    heritageCount: save.heritageCount,
    equipment: c.equipment.map((item) => {
      const catalogItem = gameData.equipment.catalog.find((i) => i.id === item.catalogId);
      if (!catalogItem) throw new Error(`Objet inconnu : ${item.catalogId}`);
      return itemStats(gameData.equipment, catalogItem, item.upgradeLevel);
    }),
    deck: c.skills.map((s) => ({ position: s.position, skillId: s.skillId })),
    allocation: toAllocation(c.statPoints),
  }));
}

export async function getCombat(prisma: PrismaClient, saveId: string): Promise<CombatResponse> {
  const session = await prisma.combatSession.findUnique({ where: { saveId } });
  return {
    combat: session ? toCombatView(session.state as unknown as CombatState) : null,
    events: [],
    outcome: null,
  };
}

/**
 * Lance un combat : un étage de la tour (l'étage courant, ou un boss/dragon déjà battu),
 * ou une zone de chasse débloquée (étage de boss déjà battu).
 */
export async function startCombat(
  prisma: PrismaClient,
  saveId: string,
  floor: number,
  mode: CombatMode = 'tower',
): Promise<CombatResponse> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    if (await tx.combatSession.findUnique({ where: { saveId }, select: { saveId: true } })) {
      throw new HttpError(409, 'COMBAT_IN_PROGRESS');
    }
    const save = await tx.save.findUniqueOrThrow({
      where: { id: saveId },
      include: { upgradeTower: true },
    });
    if (mode === 'tower' && !canPlayFloor(save, floor)) throw new HttpError(409, 'FLOOR_LOCKED');
    if (
      mode === 'hunt' &&
      !unlockedHuntingZones(gameData.zones, save.highestFloorCleared).some((z) => z.floor === floor)
    ) {
      throw new HttpError(409, 'ZONE_LOCKED');
    }
    const heroes = await loadTeam(tx, saveId);
    if (heroes.length === 0) throw new HttpError(409, 'NO_CHARACTER');

    const { state, events } = createCombat(gameData, {
      floor,
      mode,
      heroes,
      tower: towerLevels(save.upgradeTower),
      seed: randomInt(0, 2 ** 32 - 1),
    });
    await tx.combatSession.create({
      data: { saveId, floor, state: state as unknown as Prisma.InputJsonValue },
    });
    return { combat: toCombatView(state), events, outcome: null };
  });
}

/**
 * Applique une action du moteur au combat en cours. Si le combat se termine,
 * les récompenses sont attribuées et le combat est supprimé, dans la même transaction.
 */
export async function playCombat(
  prisma: PrismaClient,
  userId: string,
  saveId: string,
  step: (state: CombatState) => CombatResult,
): Promise<CombatResponse> {
  return prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    const session = await tx.combatSession.findUnique({ where: { saveId } });
    if (!session) throw new HttpError(404, 'NO_COMBAT');

    let result: CombatResult;
    try {
      result = step(session.state as unknown as CombatState);
    } catch (error) {
      if (error instanceof CombatError) throw new HttpError(409, error.code);
      throw error;
    }

    if (result.state.phase === 'heroes') {
      await tx.combatSession.update({
        where: { saveId },
        data: { state: result.state as unknown as Prisma.InputJsonValue },
      });
      return { combat: toCombatView(result.state), events: result.events, outcome: null };
    }

    await tx.combatSession.delete({ where: { saveId } });
    const outcome = await finishCombat(tx, userId, saveId, result.state);
    return { combat: toCombatView(result.state), events: result.events, outcome };
  });
}

/** Fin de combat : or et XP (même en cas de défaite), progression si l'étage courant est gagné. */
async function finishCombat(
  tx: Tx,
  userId: string,
  saveId: string,
  state: CombatState,
): Promise<CombatOutcome> {
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    include: { characters: true, upgradeTower: true, buildings: true },
  });
  const bonus = upgradeTowerBonus(gameData.village, towerLevels(save.upgradeTower), 'goldXp');
  const rewards = combatRewards(gameData.monsters, state, bonus);

  const levelUps: CombatOutcome['levelUps'] = [];
  for (const character of save.characters) {
    const gained = rewards.xp[character.id];
    if (!gained) continue;
    const next = addXp(gameData.monsters, character, gained);
    if (next.levelsGained > 0)
      levelUps.push({ characterId: character.id, from: character.level, to: next.level });
    await tx.character.update({
      where: { id: character.id },
      data: { level: next.level, xp: next.xp },
    });
  }
  if (rewards.gold > 0) {
    await tx.save.update({
      where: { id: saveId },
      data: { gold: { increment: BigInt(rewards.gold) } },
    });
  }

  // Progression : seule la victoire sur l'étage courant fait monter (les boss rejoués ne comptent pas).
  const victory = state.phase === 'victory';
  const mode = state.mode ?? 'tower';
  // La chasse ne fait jamais monter dans la tour.
  const floorCleared = mode === 'tower' && victory && state.floor === save.currentFloor;
  const unlocked: CombatOutcome['unlocked'] = { elements: [], buildings: [], huntingZones: [] };
  if (floorCleared) {
    const highest = Math.max(save.highestFloorCleared, state.floor);
    const elementsBefore = new Set(save.unlockedElements);
    const buildingsBefore = new Set(save.buildings.map((b) => b.buildingId));
    await applyTowerProgress(tx, saveId, {
      currentFloor: Math.min(state.floor + 1, TOWER_FLOORS),
      highestFloorCleared: highest,
    });
    const bestFloor = Math.max(save.bestFloorEver, highest);
    unlocked.elements = unlockedElements(gameData.elements, highest).filter(
      (e: ElementId) => !elementsBefore.has(e),
    );
    unlocked.buildings = unlockedBuildings(gameData.village, bestFloor).filter(
      (b) => !buildingsBefore.has(b),
    );
    unlocked.huntingZones = gameData.zones.zones
      .filter(
        (z) =>
          z.hasHuntingZone && z.floor === state.floor && state.floor > save.highestFloorCleared,
      )
      .map((z) => z.name);
  }

  // Butin : un tirage pour l'équipe (solo), sur les monstres vaincus, même en cas de défaite.
  const drops = rollLoot(
    gameData,
    state.rng,
    state.killed,
    state.floor,
    state.heroes.map((h) => h.classId!),
  );
  const loot: CombatOutcome['loot'] = [];
  for (const drop of drops) {
    const item = await tx.item.create({ data: { saveId, catalogId: drop.catalogId } });
    loot.push({ itemId: item.id, catalogId: drop.catalogId });
  }

  return {
    result: state.phase === 'retreat' ? 'retreat' : victory ? 'victory' : 'defeat',
    mode,
    floor: state.floor,
    gold: rewards.gold,
    xp: rewards.xp,
    levelUps,
    floorCleared,
    unlocked,
    loot,
    save: await loadSave(tx, userId),
  };
}
