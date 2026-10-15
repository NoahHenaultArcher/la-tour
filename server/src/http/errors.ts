import type { ApiErrorBody, ApiErrorCode } from '@la-tour/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isClientRoute } from './client-files.ts';

/** Erreur HTTP métier : un statut et un code, traduits côté client via fr.json. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

/** Valide une entrée avec Zod ; en cas d'échec, erreur 400 avec le détail des champs. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

export function registerErrorHandling(
  app: FastifyInstance,
  { clientApp = false }: { clientApp?: boolean } = {},
): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      const body: ApiErrorBody = { error: { code: error.code, details: error.details } };
      return reply.status(error.statusCode).send(body);
    }
    // Erreurs de Fastify lui-même (JSON mal formé, type de contenu refusé…).
    const status = error.statusCode ?? 500;
    if (status === 400 || status === 415) {
      return reply.status(400).send({ error: { code: 'VALIDATION' } } satisfies ApiErrorBody);
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL' } } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((request, reply) => {
    // Lien direct vers une page du jeu (/village…) : le client choisit la vue à afficher.
    if (clientApp && isClientRoute(request)) return reply.sendFile('index.html');
    return reply.status(404).send({ error: { code: 'NOT_FOUND' } } satisfies ApiErrorBody);
  });
}
