import type { PrismaClient } from '@prisma/client';
import type { UserDto } from '@la-tour/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../http/errors.ts';
import { SESSION_COOKIE, findSessionUser } from './session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Compte connecté, renseigné par requireUser. */
    user: UserDto | null;
  }
}

/** preHandler : exige une session valide et renseigne request.user. */
export function requireUser(prisma: PrismaClient) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await findSessionUser(prisma, token) : null;
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED');
    request.user = user;
  };
}

/** preHandler (après requireUser) : exige le rôle admin en base. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  if (request.user?.role !== 'admin') throw new HttpError(403, 'FORBIDDEN');
}

/** Utilisateur connecté (après requireUser). */
export function currentUser(request: FastifyRequest): UserDto {
  if (!request.user) throw new HttpError(401, 'UNAUTHENTICATED');
  return request.user;
}
