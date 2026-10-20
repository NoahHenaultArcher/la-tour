/**
 * Salons multijoueurs, gardés en mémoire par le serveur (un redémarrage les ferme ; les récompenses,
 * elles, sont écrites en base à la fin de chaque combat). Chaque salon traite ses requêtes une par une
 * (file d'attente) : deux joueurs qui agissent en même temps ne peuvent pas se marcher dessus.
 *
 * Règles (prompt §12 et décisions du 13/10/2026) : 3 joueurs maximum, un héros chacun, « Prêt »,
 * contenu choisi par l'hôte, 3 actions par joueur et par manche, minuteur de 60 s, un joueur
 * déconnecté joue ses compétences sans recharge, chacun peut retirer son héros d'une zone de chasse.
 */
import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  CombatError,
  GAME_RULES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  createCombat,
  evolutionTier,
  type EvolutionTier,
  endHeroTurn,
  forfeitCombat,
  passHeroActions,
  performHeroAction,
  playAutoForHero,
  roomContentOptions,
  toCombatView,
  winCurrentWave,
  withdrawHero,
  type ApiErrorCode,
  type ChatMessage,
  type ClassId,
  type HostProgress,
  type CombatEvent,
  type CombatResult,
  type CombatState,
  type MultiAction,
  type MultiCombatUpdate,
  type MultiPlayerReward,
  type RoomContent,
  type RoomView,
  type SaveDto,
  type UserDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { loadHeroSetup } from '../combat/service.ts';
import { equippedRelics } from '../relics/service.ts';
import { loadSave } from '../save/service.ts';
import { rewardParticipant, type Participant } from './rewards.ts';

/** Erreur renvoyée au joueur dans l'accusé de réception (code traduit par le client). */
export class RoomError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'RoomError';
  }
}

/** Envoi des événements : branché sur Socket.IO (voir socket.ts), remplaçable dans les tests. */
export interface RoomUpdate {
  state?: RoomView | null;
  chat?: ChatMessage;
  combat?: MultiCombatUpdate;
  save?: SaveDto;
}

export interface RoomTransport {
  /** Envoie une mise à jour à toutes les connexions d'un joueur. */
  user(userId: string, update: RoomUpdate): void;
}

interface Player {
  userId: string;
  username: string;
  saveId: string;
  characterId: string | null;
  classId: ClassId | null;
  /** Palier d'évolution de la classe (héritages du joueur). */
  evolution: EvolutionTier;
  level: number | null;
  ready: boolean;
  connected: boolean;
  /** A quitté le salon pendant un combat : son héros joue seul jusqu'à la fin. */
  left: boolean;
  heroId: string | null;
  withdrawn: boolean;
  graceTimer: NodeJS.Timeout | null;
}

interface ActiveCombat {
  state: CombatState;
  participants: (Participant & { heroId: string })[];
  /** Récompenses déjà versées (joueurs qui ont retiré leur héros d'une chasse). */
  rewards: MultiPlayerReward[];
  phaseKey: string;
  deadline: number | null;
  timer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  hostId: string;
  players: Player[];
  content: RoomContent | null;
  hostProgress: HostProgress;
  chat: ChatMessage[];
  nextChatId: number;
  combat: ActiveCombat | null;
  queue: Promise<void>;
}

export interface ManagerOptions {
  /** Durée d'un tour des héros (ms) ; 60 s par défaut. */
  turnMs?: number;
  /** Délai avant qu'un joueur déconnecté hors combat soit retiré du salon (ms). */
  lobbyGraceMs?: number;
  /** Outils de debug autorisés (jamais en production). */
  debug?: boolean;
}

const MAX_CHAT = 50;

export class MultiplayerManager {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();
  private readonly turnMs: number;
  private readonly lobbyGraceMs: number;
  private readonly debug: boolean;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: RoomTransport,
    options: ManagerOptions = {},
  ) {
    this.turnMs = options.turnMs ?? GAME_RULES.multiplayerTurnSeconds * 1000;
    this.lobbyGraceMs = options.lobbyGraceMs ?? 60_000;
    this.debug = options.debug ?? false;
  }

  /** Le joueur est-il dans un combat multijoueur (pour bloquer le solo et l'héritage) ? */
  isInCombat(userId: string): boolean {
    const room = this.roomOf(userId);
    return !!room?.combat?.participants.some(
      (p) => p.userId === userId && !this.player(room, userId)?.withdrawn,
    );
  }

  roomCodeOf(userId: string): string | null {
    return this.userRoom.get(userId) ?? null;
  }

  /** Arrête les minuteurs (fermeture du serveur, fin des tests). */
  close(): void {
    for (const room of this.rooms.values()) {
      if (room.combat?.timer) clearTimeout(room.combat.timer);
      for (const p of room.players) if (p.graceTimer) clearTimeout(p.graceTimer);
    }
    this.rooms.clear();
    this.userRoom.clear();
  }

  // -------------------------------------------------------------------------
  // Salon
  // -------------------------------------------------------------------------

  async create(user: UserDto): Promise<string> {
    if (this.userRoom.has(user.id)) throw new RoomError('ALREADY_IN_ROOM');
    const player = await this.newPlayer(user);
    if (this.userRoom.has(user.id)) throw new RoomError('ALREADY_IN_ROOM');
    let code: string;
    do {
      code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: user.id,
      players: [player],
      content: null,
      hostProgress: await this.progressOf(player.saveId),
      chat: [],
      nextChatId: 1,
      combat: null,
      queue: Promise.resolve(),
    };
    room.content = { mode: 'tower', floor: room.hostProgress.currentFloor };
    this.rooms.set(code, room);
    this.userRoom.set(user.id, code);
    this.broadcast(room);
    return code;
  }

  async join(user: UserDto, code: string): Promise<void> {
    const current = this.userRoom.get(user.id);
    if (current === code) {
      this.sync(user.id);
      return;
    }
    if (current) throw new RoomError('ALREADY_IN_ROOM');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    await this.run(room, async () => {
      if (room.players.length >= GAME_RULES.maxPlayersPerRoom) throw new RoomError('ROOM_FULL');
      if (room.combat) throw new RoomError('COMBAT_IN_PROGRESS');
      if (this.userRoom.has(user.id)) throw new RoomError('ALREADY_IN_ROOM');
      room.players.push(await this.newPlayer(user));
      this.userRoom.set(user.id, code);
      this.broadcast(room);
    });
  }

  async leave(userId: string): Promise<void> {
    const room = this.roomOf(userId);
    if (!room) return;
    await this.run(room, async () => {
      const player = this.player(room, userId);
      if (!player) return;
      this.userRoom.delete(userId);
      this.transport.user(userId, { state: null });
      if (room.combat && player.heroId && !player.withdrawn) {
        // Son héros reste dans le combat et joue seul ; il reçoit ses gains à la fin.
        player.left = true;
        player.connected = false;
        await this.autoPlayAbsent(room, []);
      } else {
        this.removePlayer(room, userId);
      }
      this.broadcast(room);
    });
  }

  async setCharacter(userId: string, characterId: string): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      if (room.combat) throw new RoomError('COMBAT_IN_PROGRESS');
      const player = this.player(room, userId)!;
      const character = await this.prisma.character.findFirst({
        where: { id: characterId, saveId: player.saveId },
      });
      if (!character) throw new RoomError('NOT_FOUND');
      Object.assign(player, {
        characterId: character.id,
        classId: character.class,
        level: character.level,
        ready: false,
      });
      this.broadcast(room);
    });
  }

  async setReady(userId: string, ready: boolean): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      if (room.combat) throw new RoomError('COMBAT_IN_PROGRESS');
      const player = this.player(room, userId)!;
      if (ready && !player.characterId) throw new RoomError('NO_CHARACTER');
      player.ready = ready;
      this.broadcast(room);
    });
  }

  async chat(userId: string, text: string): Promise<void> {
    const room = this.requireRoom(userId);
    const player = this.player(room, userId)!;
    const message: ChatMessage = {
      id: room.nextChatId++,
      userId,
      username: player.username,
      text,
      at: new Date().toISOString(),
    };
    room.chat = [...room.chat, message].slice(-MAX_CHAT);
    this.toRoom(room, { chat: message });
  }

  async setContent(userId: string, content: RoomContent): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      if (room.hostId !== userId) throw new RoomError('NOT_HOST');
      if (room.combat) throw new RoomError('COMBAT_IN_PROGRESS');
      room.hostProgress = await this.progressOf(this.player(room, userId)!.saveId);
      this.checkContent(room, content);
      room.content = content;
      for (const p of room.players) p.ready = false;
      this.broadcast(room);
    });
  }

  /** L'hôte lance le combat : tout le monde a choisi son héros et est prêt. */
  async start(userId: string): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      if (room.hostId !== userId) throw new RoomError('NOT_HOST');
      if (room.combat) throw new RoomError('COMBAT_IN_PROGRESS');
      if (!room.content) throw new RoomError('NO_CONTENT');
      if (room.players.some((p) => !p.characterId || !p.ready || !p.connected))
        throw new RoomError('PLAYERS_NOT_READY');
      room.hostProgress = await this.progressOf(this.player(room, userId)!.saveId);
      this.checkContent(room, room.content);
      const solo = await this.prisma.combatSession.findFirst({
        where: { saveId: { in: room.players.map((p) => p.saveId) } },
        select: { saveId: true },
      });
      if (solo) throw new RoomError('COMBAT_IN_PROGRESS');

      const heroes = await Promise.all(
        room.players.map((p) => loadHeroSetup(this.prisma, p.saveId, p.characterId!)),
      );
      // Les reliques de chaque joueur se cumulent (18 au plus, doublons compris).
      const relics = (
        await Promise.all(room.players.map((p) => equippedRelics(this.prisma, p.saveId)))
      ).flat();
      const { state, events } = createCombat(gameData, {
        floor: room.content.floor,
        mode: room.content.mode,
        heroes,
        tower: {},
        seed: randomInt(0, 2 ** 32 - 1),
        multiplayer: true,
        relics,
      });
      room.combat = {
        state,
        participants: room.players.map((p, i) => ({
          userId: p.userId,
          username: p.username,
          saveId: p.saveId,
          characterId: p.characterId!,
          heroId: `h${i}`,
        })),
        rewards: [],
        phaseKey: '',
        deadline: null,
        timer: null,
      };
      room.players.forEach((p, i) => {
        p.heroId = `h${i}`;
        p.withdrawn = false;
      });
      this.broadcast(room);
      await this.afterStep(room, events);
    });
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  async action(userId: string, action: MultiAction): Promise<void> {
    await this.combatStep(userId, (state, heroId) =>
      performHeroAction(gameData, state, { heroId, ...action }),
    );
  }

  async pass(userId: string): Promise<void> {
    await this.combatStep(userId, (state, heroId) => passHeroActions(gameData, state, heroId));
  }

  async forfeit(userId: string): Promise<void> {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new RoomError('NOT_HOST');
    if (room.combat?.state.mode === 'hunt') throw new RoomError('NOT_A_HUNT');
    await this.combatStep(userId, (state) => forfeitCombat(gameData, state));
  }

  async debugWinWave(user: UserDto): Promise<void> {
    if (!this.debug || user.role !== 'admin') throw new RoomError('FORBIDDEN');
    await this.combatStep(user.id, (state) => winCurrentWave(gameData, state));
  }

  /** Zone de chasse : le joueur retire son héros et reçoit tout de suite ses gains. */
  async withdraw(userId: string): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      const combat = room.combat;
      const player = this.player(room, userId)!;
      if (!combat || !player.heroId || player.withdrawn) throw new RoomError('NO_COMBAT');
      if (combat.state.mode !== 'hunt') throw new RoomError('NOT_A_HUNT');
      const result = this.apply(() => withdrawHero(gameData, combat.state, player.heroId!));
      combat.state = result.state;
      player.withdrawn = true;
      const participant = combat.participants.find((p) => p.userId === userId)!;
      const reward = await rewardParticipant(
        this.prisma,
        participant,
        combat.state,
        combat.state.killed,
        true,
      );
      combat.rewards.push(reward);
      this.transport.user(userId, { save: await loadSave(this.prisma, userId) });
      this.broadcast(room);
      await this.afterStep(room, result.events);
    });
  }

  // -------------------------------------------------------------------------
  // Connexions
  // -------------------------------------------------------------------------

  /** Un joueur se (re)connecte ou perd sa dernière connexion. */
  async setConnected(userId: string, connected: boolean): Promise<void> {
    const room = this.roomOf(userId);
    if (!room) return;
    await this.run(room, async () => {
      const player = this.player(room, userId);
      if (!player || player.left) return;
      player.connected = connected;
      if (player.graceTimer) clearTimeout(player.graceTimer);
      player.graceTimer = null;
      if (!connected) {
        if (room.combat && player.heroId && !player.withdrawn) {
          await this.autoPlayAbsent(room, []);
        } else {
          // Hors combat : retiré du salon s'il ne revient pas à temps.
          player.ready = false;
          player.graceTimer = setTimeout(() => void this.leave(userId), this.lobbyGraceMs);
        }
      }
      this.broadcast(room);
    });
  }

  /** Renvoie au joueur l'état de son salon (et du combat en cours). */
  sync(userId: string): void {
    const room = this.roomOf(userId);
    this.transport.user(userId, { state: room ? this.view(room) : null });
    if (room?.combat) {
      this.transport.user(userId, {
        combat: {
          combat: toCombatView(room.combat.state),
          events: [],
          turnDeadline: this.deadlineIso(room.combat),
          outcome: null,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  private async combatStep(
    userId: string,
    step: (state: CombatState, heroId: string) => CombatResult,
  ): Promise<void> {
    const room = this.requireRoom(userId);
    await this.run(room, async () => {
      const combat = room.combat;
      const player = this.player(room, userId)!;
      if (!combat || !player.heroId || player.withdrawn) throw new RoomError('NO_COMBAT');
      const result = this.apply(() => step(combat.state, player.heroId!));
      combat.state = result.state;
      await this.afterStep(room, result.events);
    });
  }

  private apply(step: () => CombatResult): CombatResult {
    try {
      return step();
    } catch (error) {
      if (error instanceof CombatError) throw new RoomError(error.code);
      throw error;
    }
  }

  /**
   * Après chaque étape : les héros absents jouent seuls, le minuteur repart à chaque nouveau tour
   * des héros, puis tout le salon reçoit les événements (et le bilan si le combat est fini).
   */
  private async afterStep(room: Room, events: CombatEvent[]): Promise<void> {
    const combat = room.combat!;
    await this.autoPlayAbsent(room, events, false);
    if (combat.state.phase !== 'heroes') {
      await this.finish(room, events);
      return;
    }
    const key = `${combat.state.waveIndex}:${combat.state.round}`;
    if (key !== combat.phaseKey) {
      combat.phaseKey = key;
      combat.deadline = Date.now() + this.turnMs;
      if (combat.timer) clearTimeout(combat.timer);
      combat.timer = setTimeout(() => void this.onTimeout(room, key), this.turnMs);
    }
    this.toRoom(room, {
      combat: {
        combat: toCombatView(combat.state),
        events,
        turnDeadline: this.deadlineIso(combat),
        outcome: null,
      },
    });
  }

  /** Les héros des joueurs déconnectés jouent leurs compétences sans recharge. */
  private async autoPlayAbsent(room: Room, events: CombatEvent[], publish = true): Promise<void> {
    const combat = room.combat;
    if (!combat) return;
    for (let guard = 0; guard < 50 && combat.state.phase === 'heroes'; guard++) {
      const absent = room.players.find(
        (p) =>
          p.heroId &&
          !p.withdrawn &&
          (!p.connected || p.left) &&
          (combat.state.heroActions?.[p.heroId] ?? 0) > 0,
      );
      if (!absent) break;
      const result = playAutoForHero(gameData, combat.state, absent.heroId!, {
        noCooldownOnly: true,
      });
      combat.state = result.state;
      events.push(...result.events);
    }
    if (publish) await this.afterStep(room, events);
  }

  private async onTimeout(room: Room, key: string): Promise<void> {
    await this.run(room, async () => {
      const combat = room.combat;
      if (!combat || combat.phaseKey !== key || combat.state.phase !== 'heroes') return;
      // Minuteur écoulé : les actions restantes sont passées.
      const result = endHeroTurn(gameData, combat.state);
      combat.state = result.state;
      combat.phaseKey = '';
      await this.afterStep(room, result.events);
    }).catch(() => undefined);
  }

  /** Fin du combat : récompenses de chacun, bilan « qui a obtenu quoi », retour au salon. */
  private async finish(room: Room, events: CombatEvent[]): Promise<void> {
    const combat = room.combat!;
    if (combat.timer) clearTimeout(combat.timer);
    const state = combat.state;
    const rewards = [...combat.rewards];
    for (const participant of combat.participants) {
      if (rewards.some((r) => r.userId === participant.userId)) continue;
      rewards.push(await rewardParticipant(this.prisma, participant, state, state.killed, false));
    }
    const order = combat.participants.map((p) => p.userId);
    rewards.sort((a, b) => order.indexOf(a.userId) - order.indexOf(b.userId));
    room.combat = null;
    this.toRoom(room, {
      combat: {
        combat: toCombatView(state),
        events,
        turnDeadline: null,
        outcome: {
          result:
            state.phase === 'victory' ? 'victory' : state.phase === 'defeat' ? 'defeat' : 'retreat',
          mode: state.mode ?? 'tower',
          floor: state.floor,
          players: rewards,
        },
      },
    });
    for (const participant of combat.participants) {
      this.transport.user(participant.userId, {
        save: await loadSave(this.prisma, participant.userId),
      });
    }
    for (const p of [...room.players]) {
      if (p.left) {
        this.removePlayer(room, p.userId);
        continue;
      }
      p.ready = false;
      p.heroId = null;
      p.withdrawn = false;
      if (p.characterId) {
        const character = await this.prisma.character.findUnique({ where: { id: p.characterId } });
        p.level = character?.level ?? p.level;
      }
    }
    if (this.rooms.has(room.code)) {
      room.hostProgress = await this.progressOf(this.player(room, room.hostId)!.saveId);
      if (room.content) {
        try {
          this.checkContent(room, room.content);
        } catch {
          room.content = { mode: 'tower', floor: room.hostProgress.currentFloor };
        }
      }
      this.broadcast(room);
    }
  }

  private checkContent(room: Room, content: RoomContent): void {
    const options = roomContentOptions(gameData, room.hostProgress);
    if (!options.some((o) => o.mode === content.mode && o.floor === content.floor))
      throw new RoomError(
        content.mode === 'hunt'
          ? 'ZONE_LOCKED'
          : content.mode === 'abyss'
            ? 'ABYSS_LOCKED'
            : 'FLOOR_LOCKED',
      );
  }

  private async newPlayer(user: UserDto): Promise<Player> {
    const save = await this.prisma.save.findUnique({
      where: { userId: user.id },
      include: { characters: { orderBy: { createdAt: 'asc' } } },
    });
    if (!save || save.characters.length === 0) throw new RoomError('NO_CHARACTER');
    // Un seul héros : choisi automatiquement.
    const only = save.characters.length === 1 ? save.characters[0]! : null;
    return {
      userId: user.id,
      username: user.username,
      saveId: save.id,
      characterId: only?.id ?? null,
      classId: only?.class ?? null,
      evolution: evolutionTier(save.heritageCount),
      level: only?.level ?? null,
      ready: false,
      connected: true,
      left: false,
      heroId: null,
      withdrawn: false,
      graceTimer: null,
    };
  }

  private async progressOf(saveId: string) {
    const save = await this.prisma.save.findUniqueOrThrow({
      where: { id: saveId },
      select: { currentFloor: true, highestFloorCleared: true, abyssFloor: true },
    });
    return save;
  }

  private removePlayer(room: Room, userId: string): void {
    const player = this.player(room, userId);
    if (player?.graceTimer) clearTimeout(player.graceTimer);
    room.players = room.players.filter((p) => p.userId !== userId);
    if (this.userRoom.get(userId) === room.code) this.userRoom.delete(userId);
    if (room.players.length === 0 && !room.combat) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === userId) {
      // L'hôte part : le joueur suivant devient l'hôte (son étage courant par défaut).
      const next = room.players.find((p) => !p.left) ?? room.players[0]!;
      room.hostId = next.userId;
      room.content = null;
      void this.progressOf(next.saveId)
        .then((progress) => {
          room.hostProgress = progress;
          room.content = { mode: 'tower', floor: progress.currentFloor };
          this.broadcast(room);
        })
        .catch(() => undefined);
    }
  }

  private roomOf(userId: string): Room | null {
    const code = this.userRoom.get(userId);
    return code ? (this.rooms.get(code) ?? null) : null;
  }

  private requireRoom(userId: string): Room {
    const room = this.roomOf(userId);
    if (!room) throw new RoomError('NOT_IN_ROOM');
    return room;
  }

  private player(room: Room, userId: string): Player | undefined {
    return room.players.find((p) => p.userId === userId);
  }

  private run<T>(room: Room, fn: () => Promise<T>): Promise<T> {
    const result = room.queue.then(fn);
    room.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private deadlineIso(combat: ActiveCombat): string | null {
    return combat.state.phase === 'heroes' && combat.deadline
      ? new Date(combat.deadline).toISOString()
      : null;
  }

  private view(room: Room): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        isHost: p.userId === room.hostId,
        characterId: p.characterId,
        classId: p.classId,
        evolution: p.evolution,
        level: p.level,
        ready: p.ready,
        connected: p.connected && !p.left,
        heroId: p.heroId,
        withdrawn: p.withdrawn,
      })),
      content: room.content,
      contentOptions: roomContentOptions(gameData, room.hostProgress),
      chat: room.chat,
      inCombat: room.combat !== null,
    };
  }

  private broadcast(room: Room): void {
    if (!this.rooms.has(room.code)) return;
    this.toRoom(room, { state: this.view(room) });
  }

  /** Envoie à tous les joueurs encore présents dans le salon. */
  private toRoom(room: Room, update: RoomUpdate): void {
    for (const p of room.players) if (!p.left) this.transport.user(p.userId, update);
  }
}
