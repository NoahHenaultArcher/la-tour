/**
 * Multijoueur (Socket.IO) : salons de 3 joueurs maximum, un héros par joueur.
 * Le client n'envoie que des intentions (validées par Zod côté serveur) ; le serveur fait autorité
 * sur le combat, les récompenses et la progression.
 */
import { z } from 'zod';
import type { CombatEvent } from '../combat/types.ts';
import type { ClassId, ElementId } from '../constants.ts';
import { isReplayable, unlockedHuntingZones } from '../rules/tower.ts';
import type { ZonesData } from '../data/schemas.ts';
import type { ApiErrorCode } from './common.ts';
import type { CombatView } from './combat.ts';
import type { SaveDto } from './save.ts';

/** Code de salon : 6 caractères, sans 0/O ni 1/I pour éviter les confusions. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));

export const roomJoinSchema = z.strictObject({ code: roomCodeSchema });
export const roomCharacterSchema = z.strictObject({ characterId: z.uuid() });
export const roomReadySchema = z.strictObject({ ready: z.boolean() });
export const roomChatSchema = z.strictObject({ text: z.string().trim().min(1).max(200) });
export const roomContentSchema = z.strictObject({
  mode: z.enum(['tower', 'hunt']),
  floor: z.int().min(1).max(100),
});
export const multiActionSchema = z.strictObject({
  skillId: z.string().min(1).max(32),
  targetId: z.string().min(1).max(16).optional(),
});
export type RoomContent = z.infer<typeof roomContentSchema>;
export type MultiAction = z.infer<typeof multiActionSchema>;

/** Contenus que l'hôte peut choisir : son étage courant, un boss déjà battu, une zone de chasse. */
export interface RoomContentOption extends RoomContent {
  kind: 'current' | 'boss' | 'hunt';
}

export function roomContentOptions(
  data: { zones: ZonesData },
  progress: { currentFloor: number; highestFloorCleared: number },
): RoomContentOption[] {
  const options: RoomContentOption[] = [
    { kind: 'current', mode: 'tower', floor: progress.currentFloor },
  ];
  for (let floor = progress.highestFloorCleared; floor >= 1; floor--) {
    if (isReplayable(floor) && floor !== progress.currentFloor)
      options.push({ kind: 'boss', mode: 'tower', floor });
  }
  for (const zone of [...unlockedHuntingZones(data.zones, progress.highestFloorCleared)].reverse())
    options.push({ kind: 'hunt', mode: 'hunt', floor: zone.floor });
  return options;
}

export interface RoomPlayerView {
  userId: string;
  username: string;
  isHost: boolean;
  characterId: string | null;
  classId: ClassId | null;
  level: number | null;
  ready: boolean;
  connected: boolean;
  /** Héros du joueur dans le combat en cours (h0, h1…), ou null. */
  heroId: string | null;
  /** A retiré son héros d'une zone de chasse (il a déjà reçu ses gains). */
  withdrawn: boolean;
}

export interface ChatMessage {
  id: number;
  userId: string | null;
  username: string;
  text: string;
  at: string;
}

export interface RoomView {
  code: string;
  hostId: string;
  players: RoomPlayerView[];
  content: RoomContent | null;
  /** Contenus proposés par la progression de l'hôte. */
  contentOptions: RoomContentOption[];
  chat: ChatMessage[];
  inCombat: boolean;
}

/** Ce que chaque joueur a obtenu (affiché à tous, « qui a obtenu quoi »). */
export interface MultiPlayerReward {
  userId: string;
  username: string;
  classId: ClassId | null;
  xp: number;
  gold: number;
  levelUp: { from: number; to: number } | null;
  loot: { itemId: string; catalogId: string }[];
  /** L'étage était l'étage courant du joueur : il monte d'un étage. */
  floorCleared: boolean;
  /** Le joueur avait retiré son héros (zone de chasse). */
  withdrawn: boolean;
  /** Déblocages du joueur (s'il a validé son étage). */
  unlocked: { elements: ElementId[]; buildings: string[]; huntingZones: string[] };
}

export interface MultiOutcome {
  result: 'victory' | 'defeat' | 'retreat';
  mode: 'tower' | 'hunt';
  floor: number;
  players: MultiPlayerReward[];
}

export interface MultiCombatUpdate {
  combat: CombatView;
  events: CombatEvent[];
  /** Fin du tour des héros (minuteur de 60 s), horloge du serveur ; null hors tour des héros. */
  turnDeadline: string | null;
  outcome: MultiOutcome | null;
}

/** Réponse (accusé de réception) à chaque requête du client. */
export type SocketAck<T = object> = ({ ok: true } & T) | { ok: false; error: ApiErrorCode };

/** Événements serveur → client. */
export interface ServerToClientEvents {
  'room:state': (room: RoomView | null) => void;
  'room:chat': (message: ChatMessage) => void;
  'combat:update': (update: MultiCombatUpdate) => void;
  /** Sauvegarde du joueur après des récompenses (fin de combat ou retrait de chasse). */
  'save:update': (save: SaveDto) => void;
}

type Ack<T = object> = (response: SocketAck<T>) => void;

/** Événements client → serveur (chacun avec un accusé de réception). */
export interface ClientToServerEvents {
  'room:create': (ack: Ack<{ code: string }>) => void;
  'room:join': (body: unknown, ack: Ack<{ code: string }>) => void;
  'room:leave': (ack: Ack) => void;
  'room:character': (body: unknown, ack: Ack) => void;
  'room:ready': (body: unknown, ack: Ack) => void;
  'room:chat': (body: unknown, ack: Ack) => void;
  'room:content': (body: unknown, ack: Ack) => void;
  'room:start': (ack: Ack) => void;
  'combat:action': (body: unknown, ack: Ack) => void;
  'combat:pass': (ack: Ack) => void;
  /** Zone de chasse : retirer son héros (gains conservés). */
  'combat:withdraw': (ack: Ack) => void;
  /** Étage de la tour : l'hôte abandonne pour tout le groupe. */
  'combat:forfeit': (ack: Ack) => void;
  /** Debug (compte admin, hors production) : gagne la vague en cours. */
  'combat:debugWinWave': (ack: Ack) => void;
  /** Demande l'état courant (après une reconnexion). */
  'room:sync': (ack: Ack) => void;
}
