import type { LeaderboardDto } from '@la-tour/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  registerAdmin,
  resetDatabase,
  type TestContext,
} from './helpers.ts';

describeWithDb('classement', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => resetDatabase(ctx.prisma));

  /** Crée un joueur avec un Guerrier, puis fixe son étage (et donc son score). */
  async function player(username: string, floorsCleared: number): Promise<string> {
    const cookie = await register(ctx.app, username);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/save/class',
      headers: { cookie },
      payload: { classId: 'warrior' },
    });
    await ctx.prisma.save.updateMany({
      where: { user: { usernameKey: username.toLowerCase() } },
      data: { highestFloorCleared: floorsCleared },
    });
    return cookie;
  }

  const leaderboard = async (cookie: string): Promise<LeaderboardDto> =>
    (await ctx.app.inject({ method: 'GET', url: '/api/leaderboard', headers: { cookie } })).json();

  it('exige une session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(response.statusCode).toBe(401);
  });

  it('top 10 trié par score, et la place du joueur quand il est plus bas', async () => {
    const cookies: string[] = [];
    for (let i = 0; i < 12; i++) cookies.push(await player(`joueur${i}`, i * 5));
    // Un compte sans héros n'est pas classé, un admin non plus (même avec le meilleur score).
    await register(ctx.app, 'sanshero');
    const admin = await registerAdmin(ctx, 'chef');
    await ctx.prisma.save.updateMany({
      where: { user: { usernameKey: 'chef' } },
      data: { highestFloorCleared: 100, heritageCount: 3 },
    });

    const last = await leaderboard(cookies[0]!);
    expect(last.players).toBe(12);
    expect(last.top).toHaveLength(10);
    expect(last.top.map((e) => e.username).slice(0, 3)).toEqual([
      'joueur11',
      'joueur10',
      'joueur9',
    ]);
    expect(last.top.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const scores = last.top.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(last.top.some((e) => e.isMe)).toBe(false);
    expect(last.me).toMatchObject({ username: 'joueur0', rank: 12, isMe: true });
    expect(last.top[0]!.heroes).toEqual([{ classId: 'warrior', level: 1 }]);

    const first = await leaderboard(cookies[11]!);
    expect(first.top[0]).toMatchObject({ username: 'joueur11', isMe: true });
    expect(first.me).toBeNull();

    // L'admin voit le classement, sans y figurer.
    const seenByAdmin = await leaderboard(admin);
    expect(seenByAdmin.players).toBe(12);
    expect(seenByAdmin.top.some((e) => e.username === 'chef')).toBe(false);
    expect(seenByAdmin.me).toBeNull();
  });
});
