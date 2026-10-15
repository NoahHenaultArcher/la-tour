import type { ClassId } from '../constants.ts';

export interface LeaderboardEntryDto {
  /** 1 pour le premier. */
  rank: number;
  username: string;
  score: number;
  floorsCleared: number;
  heritageCount: number;
  heroes: { classId: ClassId; level: number }[];
  /** Vrai pour le joueur qui demande le classement. */
  isMe: boolean;
}

export interface LeaderboardDto {
  /** Les meilleurs joueurs (LEADERBOARD_SCORE.size au plus). */
  top: LeaderboardEntryDto[];
  /** Le joueur connecté, s'il n'est pas dans le haut du classement (null sinon, ou sans héros). */
  me: LeaderboardEntryDto | null;
  /** Nombre de joueurs classés. */
  players: number;
  /** Heure de calcul (horloge du serveur). */
  updatedAt: string;
}
