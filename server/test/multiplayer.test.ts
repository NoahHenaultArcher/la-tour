import type {
  ClientToServerEvents,
  MultiCombatUpdate,
  RoomView,
  SaveDto,
  ServerToClientEvents,
  SocketAck,
} from '@la-tour/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describeWithDb('multijoueur (Socket.IO)', () => {
  let ctx: TestContext;
  let url: string;
  let hostCookie: string;
  let guestCookie: string;
  const sockets: Client[] = [];

  beforeAll(async () => {
    // Tours courts pour tester le minuteur ; hors combat, un absent est retiré vite.
    ctx = await createTestContext({}, undefined, { turnMs: 400, lobbyGraceMs: 200 });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const address = ctx.app.server.address();
    if (!address || typeof address === 'string') throw new Error('adresse inconnue');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    hostCookie = await registerAdmin(ctx, 'hote'); // un Mage, compte admin (outils de debug)
    guestCookie = await register(ctx.app, 'invite');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/save/class',
      headers: { cookie: guestCookie },
      payload: { classId: 'warrior' },
    });
  });
  afterEach(async () => {
    // Chacun quitte son salon : les salons vivent en mémoire d'un test à l'autre.
    for (const socket of sockets) if (socket.connected) await send(socket, 'room:leave');
    for (const socket of sockets.splice(0)) socket.disconnect();
    // Laisse le serveur traiter les déconnexions avant de vider la base.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /** Ouvre une connexion et garde la dernière vue du salon et les mises à jour de combat. */
  const open = async (cookie: string) => {
    const socket: Client = connect(url, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { cookie },
      forceNew: true,
    });
    sockets.push(socket);
    const seen = {
      room: null as RoomView | null,
      updates: [] as MultiCombatUpdate[],
      saves: [] as SaveDto[],
    };
    socket.on('room:state', (room) => (seen.room = room));
    socket.on('combat:update', (update) => seen.updates.push(update));
    socket.on('save:update', (save) => seen.saves.push(save));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return { socket, seen };
  };

  const send = <T extends object = object>(
    socket: Client,
    event: keyof ClientToServerEvents,
    body?: object,
  ): Promise<SocketAck<T>> =>
    new Promise((resolve) => {
      const emit = socket.emit.bind(socket) as (...args: unknown[]) => void;
      if (body === undefined) emit(event, resolve);
      else emit(event, body, resolve);
    });

  /** Attend qu'une condition devienne vraie (événements asynchrones). */
  const until = async (check: () => boolean, timeout = 3000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error('délai dépassé');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  /** Salon à deux, chacun prêt, contenu choisi par l'hôte. */
  const twoPlayers = async (content?: { mode: 'tower' | 'hunt'; floor: number }) => {
    const host = await open(hostCookie);
    const guest = await open(guestCookie);
    const created = await send<{ code: string }>(host.socket, 'room:create');
    if (!created.ok) throw new Error(created.error);
    expect(await send(guest.socket, 'room:join', { code: created.code.toLowerCase() })).toEqual({
      ok: true,
      code: created.code,
    });
    if (content) expect(await send(host.socket, 'room:content', content)).toEqual({ ok: true });
    return { host, guest, code: created.code };
  };

  const readyAndStart = async (host: Client, guest: Client) => {
    expect(await send(host, 'room:ready', { ready: true })).toEqual({ ok: true });
    expect(await send(guest, 'room:ready', { ready: true })).toEqual({ ok: true });
    expect(await send(host, 'room:start')).toEqual({ ok: true });
  };

  it('refuse une connexion sans session', async () => {
    const socket: Client = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('UNAUTHENTICATED');
  });

  it('salon : code, héros choisi automatiquement, chat, « Prêt » obligatoire, hôte seul à lancer', async () => {
    const { host, guest, code } = await twoPlayers();
    await until(() => host.seen.room?.players.length === 2);
    const room = host.seen.room!;
    expect(room.code).toBe(code);
    expect(room.players.map((p) => [p.username, p.classId, p.isHost])).toEqual([
      ['hote', 'mage', true],
      ['invite', 'warrior', false],
    ]);
    expect(room.contentOptions[0]).toEqual({ kind: 'current', mode: 'tower', floor: 1 });

    expect(await send(guest.socket, 'room:chat', { text: '  Salut !  ' })).toEqual({ ok: true });
    await until(() => host.seen.room !== null);
    expect(await send(guest.socket, 'room:start')).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(await send(host.socket, 'room:start')).toEqual({
      ok: false,
      error: 'PLAYERS_NOT_READY',
    });
    expect(await send(host.socket, 'room:content', { mode: 'tower', floor: 5 })).toEqual({
      ok: false,
      error: 'FLOOR_LOCKED',
    });
    expect(await send(guest.socket, 'room:join', { code: 'ZZZZZZ' })).toEqual({
      ok: false,
      error: 'ALREADY_IN_ROOM',
    });
    const other = await open(await register(ctx.app, 'curieux'));
    expect(await send(other.socket, 'room:join', { code: 'ZZZZZZ' })).toEqual({
      ok: false,
      error: 'ROOM_NOT_FOUND',
    });
    // Un compte sans héros ne peut pas rejoindre.
    expect(await send(other.socket, 'room:join', { code })).toEqual({
      ok: false,
      error: 'NO_CHARACTER',
    });
  });

  it('combat : 3 actions par joueur, butin et récompenses de chacun, progression sur son propre étage', async () => {
    // L'hôte est à l'étage 3, l'invité à l'étage 1 : seul l'hôte montera.
    const hostSave = await ctx.prisma.save.findFirstOrThrow({
      where: { user: { username: 'hote' } },
    });
    await ctx.prisma.save.update({
      where: { id: hostSave.id },
      data: { currentFloor: 3, highestFloorCleared: 2, bestFloorEver: 2 },
    });
    await ctx.prisma.character.updateMany({ data: { level: 30, bestLevel: 30 } });
    const { host, guest } = await twoPlayers({ mode: 'tower', floor: 3 });
    await readyAndStart(host.socket, guest.socket);
    await until(() => guest.seen.updates.length > 0);
    const first = guest.seen.updates.at(-1)!.combat;
    expect(first.heroes).toHaveLength(2);
    expect(first.actionsPerRound).toBe(3);
    expect(first.heroActions).toEqual({ h0: 3, h1: 3 });
    expect(guest.seen.updates.at(-1)!.turnDeadline).not.toBeNull();

    // Pendant le combat : pas de combat solo.
    const solo = await ctx.app.inject({
      method: 'POST',
      url: '/api/combat/start',
      headers: { cookie: guestCookie },
      payload: { floor: 1 },
    });
    expect(solo.json().error.code).toBe('IN_MULTI_COMBAT');

    // L'invité joue une action : il lui en reste 2, l'hôte en a toujours 3.
    const target = first.monsters.find((m) => m.hp > 0)!;
    expect(
      await send(guest.socket, 'combat:action', { skillId: 'GUE-A01-NEU', targetId: target.id }),
    ).toEqual({ ok: true });
    await until(
      () =>
        (host.seen.updates.at(-1)?.combat.heroActions?.h1 ?? 3) < 3 ||
        host.seen.updates.at(-1)?.combat.round !== first.round,
    );

    // Debug : l'hôte gagne les vagues jusqu'à la fin.
    for (let i = 0; i < 10 && !host.seen.updates.at(-1)?.outcome; i++) {
      await send(host.socket, 'combat:debugWinWave');
    }
    await until(() => guest.seen.updates.some((u) => u.outcome));
    const outcome = guest.seen.updates.find((u) => u.outcome)!.outcome!;
    expect(outcome.result).toBe('victory');
    expect(outcome.players.map((p) => [p.username, p.floorCleared])).toEqual([
      ['hote', true],
      ['invite', false],
    ]);
    // Or partagé comme l'XP (deux héros : 75 % chacun), sans bonus de Tour d'amélioration.
    expect(outcome.players[0]!.gold).toBe(outcome.players[1]!.gold);
    expect(outcome.players[0]!.gold).toBeGreaterThan(0);
    await until(() => host.seen.saves.length > 0 && guest.seen.saves.length > 0);
    expect(host.seen.saves.at(-1)!.currentFloor).toBe(4);
    expect(guest.seen.saves.at(-1)!.currentFloor).toBe(1);
    expect(guest.seen.saves.at(-1)!.gold).toBe(outcome.players[1]!.gold);
    // Retour au salon : plus personne n'est prêt.
    await until(() => host.seen.room?.inCombat === false);
    expect(host.seen.room!.players.every((p) => !p.ready)).toBe(true);
  });

  it('minuteur : à la fin du temps, les actions restantes sont passées', async () => {
    const { host, guest } = await twoPlayers();
    await readyAndStart(host.socket, guest.socket);
    await until(() => host.seen.updates.length > 0);
    const round = host.seen.updates[0]!.combat.round;
    await until(
      () =>
        (host.seen.updates.at(-1)?.combat.round ?? round) > round ||
        !!host.seen.updates.at(-1)?.outcome,
      3000,
    );
  });

  it('déconnexion : le héros du joueur absent joue ses compétences sans recharge', async () => {
    const { host, guest } = await twoPlayers();
    await readyAndStart(host.socket, guest.socket);
    await until(() => host.seen.updates.length > 0);
    guest.socket.disconnect();
    await until(() =>
      host.seen.updates.some((u) =>
        u.events.some((e) => e.type === 'action' && e.actorId === 'h1' && e.skillId !== null),
      ),
    );
    await until(() => host.seen.room?.players[1]?.connected === false);
  });

  it('zone de chasse : chacun peut retirer son héros et garde ses gains', async () => {
    for (const username of ['hote', 'invite']) {
      const save = await ctx.prisma.save.findFirstOrThrow({ where: { user: { username } } });
      await ctx.prisma.save.update({
        where: { id: save.id },
        data: { currentFloor: 6, highestFloorCleared: 5, bestFloorEver: 5 },
      });
    }
    await ctx.prisma.character.updateMany({ data: { level: 40, bestLevel: 40 } });
    const { host, guest } = await twoPlayers({ mode: 'hunt', floor: 5 });
    await readyAndStart(host.socket, guest.socket);
    await until(() => host.seen.updates.length > 0);
    await send(host.socket, 'combat:debugWinWave');
    expect(await send(guest.socket, 'combat:withdraw')).toEqual({ ok: true });
    await until(() => guest.seen.saves.length > 0);
    await until(() => host.seen.room?.players[1]?.withdrawn === true);
    // La chasse continue pour l'hôte ; il part à son tour.
    expect(host.seen.updates.at(-1)!.combat.heroes).toHaveLength(1);
    expect(await send(guest.socket, 'combat:action', { skillId: 'GUE-A01-NEU' })).toEqual({
      ok: false,
      error: 'NO_COMBAT',
    });
    expect(await send(host.socket, 'combat:withdraw')).toEqual({ ok: true });
    await until(() => host.seen.updates.some((u) => u.outcome));
    const outcome = host.seen.updates.find((u) => u.outcome)!.outcome!;
    expect(outcome.result).toBe('retreat');
    expect(outcome.players.map((p) => [p.username, p.withdrawn])).toEqual([
      ['hote', true],
      ['invite', true],
    ]);
    expect(outcome.players[1]!.xp).toBeGreaterThan(0);
  });
});
