/**
 * Récompenses d'un participant à un combat multijoueur, dans sa propre transaction :
 * XP et or partagés selon le nombre de héros (et sa Tour d'amélioration), un tirage de butin
 * à lui, et la progression seulement si l'étage joué était SON étage courant.
 */
import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  addXp,
  createRng,
  evolutionTier,
  participantRewards,
  relicBonus,
  upgradeTowerBonus,
  type CombatState,
  type MultiPlayerReward,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import {
  applyAbyssVictory,
  applyFloorVictory,
  clearsAbyssFloor,
  grantLoot,
  towerLevels,
} from '../combat/service.ts';
import { grantRelics } from '../relics/service.ts';
import { lockSave } from '../village/service.ts';

export interface Participant {
  userId: string;
  username: string;
  saveId: string;
  characterId: string;
}

export async function rewardParticipant(
  prisma: PrismaClient,
  participant: Participant,
  state: CombatState,
  killed: CombatState['killed'],
  withdrawn: boolean,
): Promise<MultiPlayerReward> {
  return prisma.$transaction(async (tx) => {
    const { saveId, characterId } = participant;
    await lockSave(tx, saveId);
    const save = await tx.save.findUniqueOrThrow({
      where: { id: saveId },
      include: { upgradeTower: true, buildings: true },
    });
    const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } });
    const bonus = upgradeTowerBonus(gameData.village, towerLevels(save.upgradeTower), 'goldXp');
    // Reliques du salon (cumulées) : l'or en plus vaut pour chacun.
    const rewards = participantRewards(
      gameData.monsters,
      killed,
      character.level,
      bonus,
      relicBonus(state.relics ?? []).gold,
    );

    const next = addXp(gameData.monsters, character, rewards.xp);
    await tx.character.update({
      where: { id: characterId },
      data: {
        level: next.level,
        xp: next.xp,
        bestLevel: Math.max(character.bestLevel, next.level),
      },
    });
    if (rewards.gold > 0) {
      await tx.save.update({
        where: { id: saveId },
        data: { gold: { increment: BigInt(rewards.gold) } },
      });
    }

    // Règle validée : on ne monte que si l'étage joué était son propre étage courant
    // (de la tour, ou de l'Abysse).
    const towerCleared =
      !withdrawn &&
      (state.mode ?? 'tower') === 'tower' &&
      state.phase === 'victory' &&
      state.floor === save.currentFloor;
    const abyssCleared = !withdrawn && clearsAbyssFloor(state, save);
    const floorCleared = towerCleared || abyssCleared;
    const unlocked = towerCleared
      ? await applyFloorVictory(tx, saveId, save, state.floor)
      : { elements: [], buildings: [], huntingZones: [] };
    if (abyssCleared) await applyAbyssVictory(tx, saveId, save, state.floor);

    // Un tirage par joueur, avec un aléa propre (le serveur tire la graine).
    const rng = createRng(randomInt(0, 2 ** 32 - 1));
    const loot = await grantLoot(tx, saveId, rng, killed, state.floor, state.mode ?? 'tower');
    const relics = withdrawn
      ? []
      : await grantRelics(tx, saveId, rng, killed, state.mode ?? 'tower');

    return {
      userId: participant.userId,
      username: participant.username,
      classId: character.class,
      evolution: evolutionTier(save.heritageCount),
      xp: rewards.xp,
      gold: rewards.gold,
      levelUp: next.levelsGained > 0 ? { from: character.level, to: next.level } : null,
      loot,
      relics,
      floorCleared,
      withdrawn,
      unlocked,
    };
  });
}
