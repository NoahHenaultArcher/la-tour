/**
 * Multijoueur côté client : connexion Socket.IO, salon et chat. Le combat multijoueur est rejoué
 * par le store de combat (même scène, même journal) ; ce store ne fait que transmettre.
 * Comme en solo, le client n'envoie que des intentions : le serveur décide de tout.
 */
import type {
  ChatMessage,
  ClientToServerEvents,
  MultiAction,
  RoomContent,
  RoomView,
  ServerToClientEvents,
  SocketAck,
} from '@la-tour/shared';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { ApiError } from '../api/client.ts';
import { setHeroNames } from '../game/combatText.ts';
import { useCombat } from './combat.ts';
import { useSession } from './session.ts';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RoomStore {
  connected: boolean;
  room: RoomView | null;
  chat: ChatMessage[];
  connect: () => void;
  disconnect: () => void;
  create: () => Promise<string>;
  join: (code: string) => Promise<void>;
  leave: () => Promise<void>;
  chooseCharacter: (characterId: string) => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  sendChat: (text: string) => Promise<void>;
  setContent: (content: RoomContent) => Promise<void>;
  start: () => Promise<void>;
  action: (action: MultiAction) => Promise<void>;
  pass: () => Promise<void>;
  withdraw: () => Promise<void>;
  forfeit: () => Promise<void>;
  debugWinWave: () => Promise<void>;
}

let socket: GameSocket | null = null;

/** Émet un événement et attend l'accusé de réception (erreur → ApiError traduite par le client). */
function emit<T extends object = object>(
  event: keyof ClientToServerEvents,
  body?: object,
): Promise<SocketAck<T> & { ok: true }> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new ApiError(0, 'INTERNAL'));
      return;
    }
    const done = (response: SocketAck<T>) => {
      if (response.ok) resolve(response);
      else reject(new ApiError(409, response.error));
    };
    const send = socket.emit.bind(socket) as (...args: unknown[]) => void;
    if (body === undefined) send(event, done);
    else send(event, body, done);
  });
}

export const useRoom = create<RoomStore>((set, get) => ({
  connected: false,
  room: null,
  chat: [],

  connect: () => {
    if (socket) return;
    socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('room:state', (room) => {
      set({ room, chat: room?.chat ?? [] });
      setHeroNames(
        Object.fromEntries(
          (room?.players ?? []).filter((p) => p.heroId).map((p) => [p.heroId!, p.username]),
        ),
      );
    });
    socket.on('room:chat', (message) => set((s) => ({ chat: [...s.chat, message].slice(-50) })));
    socket.on('combat:update', (update) => {
      const userId = useSession.getState().user?.id;
      const heroId = get().room?.players.find((p) => p.userId === userId)?.heroId ?? null;
      useCombat.getState().receiveMulti(update, heroId);
    });
    socket.on('save:update', (save) => useSession.getState().setSave(save));
  },

  disconnect: () => {
    socket?.disconnect();
    socket = null;
    set({ connected: false, room: null, chat: [] });
  },

  create: async () => (await emit<{ code: string }>('room:create')).code,
  join: async (code) => {
    await emit('room:join', { code });
  },
  leave: async () => {
    await emit('room:leave');
    set({ room: null, chat: [] });
  },
  chooseCharacter: async (characterId) => {
    await emit('room:character', { characterId });
  },
  setReady: async (ready) => {
    await emit('room:ready', { ready });
  },
  sendChat: async (text) => {
    await emit('room:chat', { text });
  },
  setContent: async (content) => {
    await emit('room:content', content);
  },
  start: async () => {
    await emit('room:start');
  },
  action: async (action) => {
    await emit('combat:action', action);
  },
  pass: async () => {
    await emit('combat:pass');
  },
  withdraw: async () => {
    await emit('combat:withdraw');
  },
  forfeit: async () => {
    await emit('combat:forfeit');
  },
  debugWinWave: async () => {
    await emit('combat:debugWinWave');
  },
}));
