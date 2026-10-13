import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPrisma } from './db.ts';

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const app = buildApp({ prisma, config });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.SERVER_PORT, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
