/**
 * Combats côté serveur. Le moteur (@la-tour/shared) calcule tout ; le serveur charge l'état,
 * valide l'intention du joueur, applique le moteur et enregistre, dans une transaction verrouillée.
 * À la fin du combat : or, XP (montées de niveau) et progression de la tour, en une seule fois.
 */
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { type PrismaClient } from '@prisma/client';
import {
  CLASS_IDS,
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
  type Rng,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { applyTowerProgress, loadSave } from '../save/service.ts';
import { lockSave } from '../village/service.ts';

type Tx = Prisma.TransactionClient;

export function towerLevels(rows: { branch: string; level: number }[]) {
  return Object.fromEntries(rows.map((t) => [t.branch as UpgradeTowerBranchId, t.level]));
}

const characterInclude = { skills: true, equipment: true } as const;
type CharacterWithGear = Prisma.CharacterGetPayload<{ include: typeof characterInclude }>;

/** Héros prêt pour le moteur : niveau, équipement, deck et points répartis. */
function heroSetupOf(heritageCount: number, c: CharacterWithGear): HeroSetup {
  return {
    characterId: c.id,
    classId: c.class,
    level: c.level,
    heritageCount,
    equipment: c.equipment.map((item) => {
      const catalogItem = gameData.equipment.catalog.find((i) => i.id === item.catalogId);
      if (!catalogItem) throw new Error(`Objet inconnu : ${item.catalogId}`);
      return itemStats(gameData.equipment, catalogItem, item.upgradeLevel);
    }),
    deck: c.skills.map((s) => ({
      position: s.position,
      skillId: s.skillId,
      fusionElement: s.fusionElement as ElementId | null,
    })),
    allocation: toAllocation(c.statPoints),
  };
}

/** Équipe d'une sauvegarde : tous les personnages (1 à 3), avec équipement et deck. */
async function loadTeam(tx: Tx, saveId: string): Promise<HeroSetup[]> {
  const save = await tx.save.findUniqueOrThrow({
    where: { id: saveId },
    include: { characters: { include: characterInclude, orderBy: { createdAt: 'asc' } } },
  });
  return save.characters.map((c) => heroSetupOf(save.heritageCount, c));
}

/**
 * Multijoueur : un héros précis avec les bonus de son propriétaire
 * (Tour d'amélioration, Tour d'alchimie).
 */
export async function loadHeroSetup(
  db: Tx | PrismaClient,
  saveId: string,
  characterId: string,
): Promise<HeroSetup> {
  const save = await db.save.findUniqueOrThrow({
    where: { id: saveId },
    include: {
      characters: { where: { id: characterId }, include: characterInclude },
      upgradeTower: true,
      buildings: { where: { buildingId: 'tour_alchimie' } },
    },
  });
  const character = save.characters[0];
  if (!character) throw new HttpError(404, 'NOT_FOUND');
  return {
    ...heroSetupOf(save.heritageCount, character),
    tower: towerLevels(save.upgradeTower),
    alchemyLevel: save.buildings[0]?.level ?? 0,
  };
}

/**
 * Victoire sur l'étage courant : le joueur monte d'un étage. Renvoie ce qui vient d'être débloqué
 * (éléments, bâtiments, zone de chasse).
 */
export async function applyFloorVictory(
  tx: Tx,
  saveId: string,
  save: {
    highestFloorCleared: number;
    bestFloorEver: number;
    unlockedElements: string[];
    buildings: { buildingId: string }[];
  },
  floor: number,
): Promise<CombatOutcome['unlocked']> {
  const highest = Math.max(save.highestFloorCleared, floor);
  const elementsBefore = new Set(save.unlockedElements);
  const buildingsBefore = new Set(save.buildings.map((b) => b.buildingId));
  await applyTowerProgress(tx, saveId, {
    currentFloor: Math.min(floor + 1, TOWER_FLOORS),
    highestFloorCleared: highest,
  });
  const bestFloor = Math.max(save.bestFloorEver, highest);
  return {
    elements: unlockedElements(gameData.elements, highest).filter(
      (e: ElementId) => !elementsBefore.has(e),
    ),
    buildings: unlockedBuildings(gameData.village, bestFloor).filter(
      (b) => !buildingsBefore.has(b),
    ),
    huntingZones: gameData.zones.zones
      .filter((z) => z.hasHuntingZone && z.floor === floor && floor > save.highestFloorCleared)
      .map((z) => z.name),
  };
}

/**
 * Butin d'un tirage (sur les monstres vaincus) : objets de n'importe quelle classe,
 * ajoutés à l'inventaire.
 */
export async function grantLoot(
  tx: Tx,
  saveId: string,
  rng: Rng,
  killed: CombatState['killed'],
  floor: number,
): Promise<CombatOutcome['loot']> {
  const loot: CombatOutcome['loot'] = [];
  for (const drop of rollLoot(gameData, rng, killed, floor, CLASS_IDS)) {
    const item = await tx.item.create({ data: { saveId, catalogId: drop.catalogId } });
    loot.push({ itemId: item.id, catalogId: drop.catalogId });
  }
  return loot;
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
      include: { upgradeTower: true, buildings: { where: { buildingId: 'tour_alchimie' } } },
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
      alchemyLevel: save.buildings[0]?.level ?? 0,
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
      data: {
        level: next.level,
        xp: next.xp,
        bestLevel: Math.max(character.bestLevel, next.level),
      },
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
  const unlocked: CombatOutcome['unlocked'] = floorCleared
    ? await applyFloorVictory(tx, saveId, save, state.floor)
    : { elements: [], buildings: [], huntingZones: [] };

  // Butin : un tirage pour l'équipe (solo), sur les monstres vaincus, même en cas de défaite.
  // Les objets peuvent être de n'importe quelle classe, même absente de l'équipe (à revendre ou garder).
  const loot = await grantLoot(tx, saveId, state.rng, state.killed, state.floor);

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
