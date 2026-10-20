/**
 * Deck des héros et fusions de la Tour d'alchimie. Le serveur vérifie les déblocages
 * (meilleur niveau atteint, éléments), l'ultime unique et les fusions, puis fait payer
 * les fusions nouvellement posées, le tout dans une seule transaction.
 */
import type { PrismaClient } from '@prisma/client';
import {
  fusionCost,
  newFusionCount,
  unlockLevel,
  validateDeck,
  type ElementId,
  type SetDeckBody,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { HttpError } from '../http/errors.ts';
import { collectIdle, lockSave, spendGoldAndResources } from '../village/service.ts';

const ALCHEMY_TOWER = 'tour_alchimie';

export async function setDeck(
  prisma: PrismaClient,
  saveId: string,
  { characterId, deck }: SetDeckBody,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSave(tx, saveId);
    const character = await tx.character.findFirst({
      where: { id: characterId, saveId },
      include: { skills: true },
    });
    if (!character) throw new HttpError(404, 'NOT_FOUND');
    const save = await tx.save.findUniqueOrThrow({
      where: { id: saveId },
      include: { buildings: { where: { buildingId: ALCHEMY_TOWER } } },
    });
    const alchemyLevel = save.buildings[0]?.level ?? 0;
    const error = validateDeck(gameData, {
      classId: character.class,
      level: unlockLevel(character),
      unlockedElements: save.unlockedElements as ElementId[],
      alchemyLevel,
      heritageCount: save.heritageCount,
      deck,
    });
    if (error) throw new HttpError(409, error);

    const before = character.skills.map((s) => ({
      position: s.position,
      skillId: s.skillId,
      fusionElement: s.fusionElement as ElementId | null,
      fusionElement2: s.fusionElement2 as ElementId | null,
    }));
    const added = newFusionCount(before, deck);
    if (added > 0) {
      await collectIdle(tx, saveId, now);
      const cost = fusionCost(alchemyLevel, added);
      await spendGoldAndResources(tx, saveId, cost.gold, { ether: cost.ether });
    }

    await tx.characterSkill.deleteMany({ where: { characterId } });
    await tx.characterSkill.createMany({
      data: deck.map((slot) => ({
        characterId,
        position: slot.position,
        skillId: slot.skillId,
        fusionElement: slot.fusionElement,
        fusionElement2: slot.fusionElement2 ?? null,
      })),
    });
  });
}
