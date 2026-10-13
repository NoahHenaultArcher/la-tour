/**
 * Socket.IO : authentification par le cookie de session, validation Zod de chaque événement,
 * limite de débit par connexion. Toute la logique de jeu est dans MultiplayerManager.
 */
import type { PrismaClient } from '@prisma/client';
import {
  multiActionSchema,
  roomCharacterSchema,
  roomChatSchema,
  roomContentSchema,
  roomJoinSchema,
  roomReadySchema,
  type ApiErrorCode,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketAck,
  type UserDto,
} from '@la-tour/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import { SESSION_COOKIE, findSessionUser } from '../auth/session.ts';
import type { Config } from '../config.ts';
import { MultiplayerManager, RoomError, type ManagerOptions } from './manager.ts';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, { user: UserDto }>;

/** Lit un cookie dans l'en-tête de la poignée de main. */
function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/** Limite simple : `max` événements par fenêtre de `windowMs` et par connexion. */
function rateLimiter(max: number, windowMs: number) {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}

const userChannel = (userId: string) => `user:${userId}`;

export function attachMultiplayer(
  app: FastifyInstance,
  {
    prisma,
    config,
    options = {},
  }: { prisma: PrismaClient; config: Config; options?: ManagerOptions },
): MultiplayerManager {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, { user: UserDto }>(
    app.server,
    {
      path: '/socket.io',
      cors: { origin: config.CLIENT_ORIGIN, credentials: true },
      serveClient: false,
    },
  );

  const manager = new MultiplayerManager(
    prisma,
    {
      user(userId, update) {
        const channel = io.to(userChannel(userId));
        if (update.state !== undefined) channel.emit('room:state', update.state);
        if (update.chat) channel.emit('room:chat', update.chat);
        if (update.combat) channel.emit('combat:update', update.combat);
        if (update.save) channel.emit('save:update', update.save);
      },
    },
    { debug: config.NODE_ENV !== 'production', ...options },
  );

  // Seuls les comptes connectés (cookie de session valide) ouvrent une connexion temps réel.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const user = token ? await findSessionUser(prisma, token) : null;
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = user;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on('connection', (socket: GameSocket) => {
    const user = socket.data.user;
    void socket.join(userChannel(user.id));
    void manager.setConnected(user.id, true).catch(() => undefined);
    manager.sync(user.id);

    const allow = rateLimiter(30, 5_000);
    const allowChat = rateLimiter(5, 10_000);

    /** Valide le corps, applique l'action, répond par un accusé de réception. */
    const handle = <S extends z.ZodType, R extends object = object>(
      schema: S | null,
      body: unknown,
      ack: unknown,
      action: (input: z.infer<S>) => Promise<R | void>,
      limiter = allow,
    ) => {
      const reply = (response: SocketAck<R>) => {
        if (typeof ack === 'function') (ack as (r: SocketAck<R>) => void)(response);
      };
      const fail = (error: ApiErrorCode) => reply({ ok: false, error });
      if (!limiter()) return fail('TOO_MANY_REQUESTS');
      let input: z.infer<S> = undefined as z.infer<S>;
      if (schema) {
        const parsed = schema.safeParse(body);
        if (!parsed.success) return fail('VALIDATION');
        input = parsed.data;
      }
      action(input).then(
        (result) => reply({ ok: true, ...(result ?? {}) } as SocketAck<R>),
        (error: unknown) => {
          if (error instanceof RoomError) return fail(error.code);
          app.log.error({ err: error }, 'erreur multijoueur');
          fail('INTERNAL');
        },
      );
    };

    socket.on('room:create', (ack) =>
      handle(null, undefined, ack, async () => ({ code: await manager.create(user) })),
    );
    socket.on('room:join', (body, ack) =>
      handle(roomJoinSchema, body, ack, async ({ code }) => {
        await manager.join(user, code);
        return { code };
      }),
    );
    socket.on('room:leave', (ack) => handle(null, undefined, ack, () => manager.leave(user.id)));
    socket.on('room:character', (body, ack) =>
      handle(roomCharacterSchema, body, ack, ({ characterId }) =>
        manager.setCharacter(user.id, characterId),
      ),
    );
    socket.on('room:ready', (body, ack) =>
      handle(roomReadySchema, body, ack, ({ ready }) => manager.setReady(user.id, ready)),
    );
    socket.on('room:chat', (body, ack) =>
      handle(roomChatSchema, body, ack, ({ text }) => manager.chat(user.id, text), allowChat),
    );
    socket.on('room:content', (body, ack) =>
      handle(roomContentSchema, body, ack, (content) => manager.setContent(user.id, content)),
    );
    socket.on('room:start', (ack) => handle(null, undefined, ack, () => manager.start(user.id)));
    socket.on('room:sync', (ack) =>
      handle(null, undefined, ack, async () => manager.sync(user.id)),
    );
    socket.on('combat:action', (body, ack) =>
      handle(multiActionSchema, body, ack, (action) => manager.action(user.id, action)),
    );
    socket.on('combat:pass', (ack) => handle(null, undefined, ack, () => manager.pass(user.id)));
    socket.on('combat:withdraw', (ack) =>
      handle(null, undefined, ack, () => manager.withdraw(user.id)),
    );
    socket.on('combat:forfeit', (ack) =>
      handle(null, undefined, ack, () => manager.forfeit(user.id)),
    );
    socket.on('combat:debugWinWave', (ack) =>
      handle(null, undefined, ack, () => manager.debugWinWave(user)),
    );

    socket.on('disconnect', () => {
      // Déconnecté seulement quand sa dernière connexion (onglet) se ferme.
      void io
        .in(userChannel(user.id))
        .fetchSockets()
        .then((sockets) => {
          if (sockets.length === 0) return manager.setConnected(user.id, false);
        })
        .catch(() => undefined);
    });
  });

  app.addHook('onClose', async () => {
    manager.close();
    // Le serveur HTTP est déjà fermé par Fastify : on ignore l'erreur de double fermeture.
    await io.close().catch(() => undefined);
  });
  return manager;
}
