import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Sert le client compilé (client/dist) : en production, jeu et API partagent la même origine,
 * ce qui garde le cookie de session (SameSite=Lax) et Socket.IO sans CORS.
 */
export function registerClientFiles(app: FastifyInstance, root: string): void {
  app.register(fastifyStatic, {
    root,
    setHeaders(reply, filePath) {
      // Fichiers générés par Vite : leur nom contient une empreinte, ils ne changent jamais.
      if (path.relative(root, filePath).startsWith(`assets${path.sep}`)) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
}

/** Page du client (React Router) : ni l'API, ni Socket.IO, ni un fichier (image absente…). */
export function isClientRoute(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = request.url.split('?')[0]!;
  if (pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')) return false;
  return !path.posix.basename(pathname).includes('.');
}
