import { Prisma, type PrismaClient } from '@prisma/client';
import { loginBodySchema, registerBodySchema, usernameKey, type UserDto } from '@la-tour/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.ts';
import { HttpError, parseInput } from '../http/errors.ts';
import type { RateLimits } from '../http/rate-limits.ts';
import { createInitialSave } from '../save/service.ts';
import { currentUser, requireUser } from './guards.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { SESSION_COOKIE, cookieOptions, createSession, deleteSession } from './session.ts';

interface Deps {
  prisma: PrismaClient;
  config: Config;
  rateLimits: RateLimits;
}

export async function authRoutes(
  app: FastifyInstance,
  { prisma, config, rateLimits }: Deps,
): Promise<void> {
  const startSession = async (reply: FastifyReply, userId: string) => {
    const { token, expiresAt } = await createSession(prisma, userId);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions(config, expiresAt));
  };

  // Inscription : pseudo + mot de passe, crée le compte et sa sauvegarde unique.
  app.post(
    '/api/auth/register',
    { config: { rateLimit: rateLimits.register } },
    async (request, reply) => {
      const { username, password } = parseInput(registerBodySchema, request.body);
      const key = usernameKey(username);
      if (await prisma.user.findUnique({ where: { usernameKey: key }, select: { id: true } })) {
        throw new HttpError(409, 'USERNAME_TAKEN');
      }
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { username, usernameKey: key, passwordHash },
          });
          await createInitialSave(tx, created.id);
          return created;
        });
      } catch (error) {
        // Deux inscriptions simultanées avec le même pseudo.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new HttpError(409, 'USERNAME_TAKEN');
        }
        throw error;
      }
      await startSession(reply, user.id);
      const body: { user: UserDto } = {
        user: { id: user.id, username: user.username, role: user.role },
      };
      return reply.status(201).send(body);
    },
  );

  // Connexion : nombre de tentatives limité par adresse IP.
  app.post(
    '/api/auth/login',
    { config: { rateLimit: rateLimits.login } },
    async (request, reply) => {
      const { username, password } = parseInput(loginBodySchema, request.body);
      const user = await prisma.user.findUnique({ where: { usernameKey: usernameKey(username) } });
      const valid = await verifyPassword(user?.passwordHash ?? null, password);
      if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS');
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await startSession(reply, user.id);
      const body: { user: UserDto } = {
        user: { id: user.id, username: user.username, role: user.role },
      };
      return body;
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(prisma, token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions(config));
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireUser(prisma) }, async (request) => ({
    user: currentUser(request),
  }));
}
