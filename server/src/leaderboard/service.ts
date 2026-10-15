/**
 * Classement : score de chaque joueur (hors admins) ayant au moins un héros, calculé par le serveur à partir des
 * sauvegardes (règle dans shared/src/rules/leaderboard.ts). Le calcul lit toute la base : il est
 * gardé en cache quelques instants.
 */
import type { PrismaClient } from '@prisma/client';
import {
  LEADERBOARD_SCORE,
  byId,
  leaderboardScore,
  type LeaderboardDto,
  type LeaderboardEntryDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';

/** Durée de validité du classement calculé. */
export const LEADERBOARD_CACHE_MS = 60_000;

interface RankedPlayer extends Omit<LeaderboardEntryDto, 'isMe'> {
  userId: string;
}

export async function computeRanking(prisma: PrismaClient): Promise<RankedPlayer[]> {
  const saves = await prisma.save.findMany({
    // Les comptes admin (outils de debug) ne sont pas classés.
    where: { characters: { some: {} }, user: { role: { not: 'admin' } } },
    select: {
      userId: true,
      highestFloorCleared: true,
      heritageCount: true,
      bestAbyssFloor: true,
      user: { select: { username: true } },
      characters: { select: { class: true, level: true }, orderBy: { createdAt: 'asc' } },
      items: {
        where: { equippedById: { not: null } },
        select: { catalogId: true, upgradeLevel: true },
      },
      buildings: { select: { level: true } },
    },
  });
  const players = saves.map((save) => {
    const score = leaderboardScore(gameData.equipment, {
      floorsCleared: save.highestFloorCleared,
      heritageCount: save.heritageCount,
      heroLevels: save.characters.map((c) => c.level),
      equipped: save.items.flatMap((i) => {
        const item = byId(gameData.equipment.catalog, i.catalogId);
        return item ? [{ item, upgradeLevel: i.upgradeLevel }] : [];
      }),
      buildingLevels: save.buildings.map((b) => b.level),
      bestAbyssFloor: save.bestAbyssFloor,
    });
    return {
      userId: save.userId,
      username: save.user.username,
      score: score.total,
      floorsCleared: save.highestFloorCleared,
      heritageCount: save.heritageCount,
      bestAbyssFloor: save.bestAbyssFloor,
      heroes: save.characters.map((c) => ({ classId: c.class, level: c.level })),
    };
  });
  // À égalité de score : l'Abysse, la progression dans la tour, puis l'ordre alphabétique.
  players.sort(
    (a, b) =>
      b.score - a.score ||
      b.bestAbyssFloor - a.bestAbyssFloor ||
      b.heritageCount * 100 + b.floorsCleared - (a.heritageCount * 100 + a.floorsCleared) ||
      a.username.localeCompare(b.username, 'fr'),
  );
  return players.map((p, i) => ({ ...p, rank: i + 1 }));
}

/** Classement vu par un joueur : le haut du tableau, et sa propre ligne s'il n'y figure pas. */
export function leaderboardFor(
  ranking: readonly RankedPlayer[],
  userId: string,
  updatedAt: Date,
): LeaderboardDto {
  const entry = ({ userId: id, ...rest }: RankedPlayer): LeaderboardEntryDto => ({
    ...rest,
    isMe: id === userId,
  });
  const top = ranking.slice(0, LEADERBOARD_SCORE.size).map(entry);
  const mine = ranking.find((p) => p.userId === userId);
  return {
    top,
    me: mine && mine.rank > LEADERBOARD_SCORE.size ? entry(mine) : null,
    players: ranking.length,
    updatedAt: updatedAt.toISOString(),
  };
}

/** Classement mis en cache pour LEADERBOARD_CACHE_MS. */
export function createLeaderboardCache(prisma: PrismaClient, ttlMs = LEADERBOARD_CACHE_MS) {
  let cached: { ranking: RankedPlayer[]; at: Date } | null = null;
  let pending: Promise<{ ranking: RankedPlayer[]; at: Date }> | null = null;
  return async (userId: string): Promise<LeaderboardDto> => {
    if (!cached || Date.now() - cached.at.getTime() >= ttlMs) {
      // Plusieurs visites simultanées ne lancent qu'un seul calcul.
      pending ??= computeRanking(prisma)
        .then((ranking) => (cached = { ranking, at: new Date() }))
        .finally(() => (pending = null));
      await pending;
    }
    return leaderboardFor(cached!.ranking, userId, cached!.at);
  };
}
