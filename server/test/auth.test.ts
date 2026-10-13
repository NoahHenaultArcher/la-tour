import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '../src/http/rate-limits.ts';
import {
  PASSWORD,
  closeTestContext,
  createTestContext,
  describeWithDb,
  register,
  resetDatabase,
  sessionCookie,
  type TestContext,
} from './helpers.ts';

describeWithDb('comptes', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => closeTestContext(ctx));
  beforeEach(async () => resetDatabase(ctx.prisma));

  const post = (url: string, payload: unknown, cookie?: string) =>
    ctx.app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: cookie ? { cookie } : {},
    });
  const me = (cookie?: string) =>
    ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

  it('inscription : crée le compte, sa sauvegarde et ouvre une session', async () => {
    const response = await post('/api/auth/register', { username: 'Noah', password: PASSWORD });
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ username: 'Noah', role: 'player' });

    const cookie = response.cookies.find((c) => c.name === 'latour_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie.secure).toBeFalsy();

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { usernameKey: 'noah' },
      include: { save: true },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.save).not.toBeNull();
    expect((await me(sessionCookie(response))).json().user.username).toBe('Noah');
  });

  it('ne stocke jamais le jeton de session en clair', async () => {
    const cookie = await register(ctx.app, 'Noah');
    const token = cookie.split('=')[1]!;
    const sessions = await ctx.prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).not.toBe(token);
  });

  it('refuse un pseudo déjà pris, sans tenir compte de la casse', async () => {
    await register(ctx.app, 'Noah');
    const response = await post('/api/auth/register', { username: 'NOAH', password: PASSWORD });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'USERNAME_TAKEN' } });
  });

  it('valide le pseudo et le mot de passe', async () => {
    for (const payload of [
      { username: 'ab', password: PASSWORD },
      { username: 'avec espace', password: PASSWORD },
      { username: 'Noah', password: 'court' },
      { username: 'Noah' },
      'pas du JSON',
    ]) {
      const response = await post('/api/auth/register', payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION');
    }
  });

  it('connexion : bon mot de passe accepté, mauvais refusé avec le même message qu’un compte inconnu', async () => {
    await register(ctx.app, 'Noah');
    const ok = await post('/api/auth/login', { username: 'noah', password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect((await me(sessionCookie(ok))).statusCode).toBe(200);

    const wrong = await post('/api/auth/login', {
      username: 'Noah',
      password: 'mauvais-mot-de-passe',
    });
    const unknown = await post('/api/auth/login', { username: 'Personne', password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('limite les tentatives de connexion et les inscriptions (limites réelles)', async () => {
    const strict = await createTestContext({}, DEFAULT_RATE_LIMITS);
    try {
      const attempt = () =>
        strict.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'Noah', password: 'faux' },
        });
      for (let i = 0; i < DEFAULT_RATE_LIMITS.login.max; i++)
        expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(blocked.json().error.details.retryAfterSeconds).toBeGreaterThan(0);

      const signUp = (i: number) =>
        strict.app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { username: `joueur${i}`, password: PASSWORD },
        });
      for (let i = 0; i < DEFAULT_RATE_LIMITS.register.max; i++)
        expect((await signUp(i)).statusCode).toBe(201);
      expect((await signUp(99)).statusCode).toBe(429);
    } finally {
      await closeTestContext(strict);
    }
  });

  it('déconnexion : la session n’est plus valable', async () => {
    const cookie = await register(ctx.app, 'Noah');
    const response = await post('/api/auth/logout', {}, cookie);
    expect(response.statusCode).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('refuse une session absente, inventée ou expirée', async () => {
    expect((await me()).json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect((await me('latour_session=invente')).statusCode).toBe(401);
    const cookie = await register(ctx.app, 'Noah');
    await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await ctx.prisma.session.count()).toBe(0);
  });

  it('cookie Secure en production', async () => {
    const prod = await createTestContext({ NODE_ENV: 'production' });
    try {
      const response = await prod.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'Prod', password: PASSWORD },
      });
      expect(response.cookies.find((c) => c.name === 'latour_session')!.secure).toBe(true);
    } finally {
      await closeTestContext(prod);
    }
  });
});
