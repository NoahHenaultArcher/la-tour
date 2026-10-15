import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPrisma } from './db.ts';

// Client compilé (pnpm build) : servi par le serveur s'il existe, sinon Vite s'en charge (pnpm dev).
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const app = buildApp({
  prisma,
  config,
  clientDir: existsSync(path.join(clientDir, 'index.html')) ? clientDir : undefined,
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.PORT ?? config.SERVER_PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
