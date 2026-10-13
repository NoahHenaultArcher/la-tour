/**
 * Sessions : un jeton aléatoire dans un cookie httpOnly ; la base ne stocke que son hachage.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import type { UserDto } from '@la-tour/shared';
import type { Config } from '../config.ts';

export const SESSION_COOKIE = 'latour_session';
const SESSION_DURATION_MS = 30 * 24 * 3_600_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function cookieOptions(config: Config, expires?: Date): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  // On profite de la connexion pour purger les sessions expirées du compte.
  await prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function findSessionUser(
  prisma: PrismaClient,
  token: string,
): Promise<UserDto | null> {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  const { id, username, role } = session.user;
  return { id, username, role };
}

export async function deleteSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
