/**
 * Seed de développement : crée (ou met à jour) le compte admin et sa sauvegarde.
 * Le mot de passe est lu dans ADMIN_PASSWORD (.env), jamais écrit dans le code.
 * Refuse de s'exécuter en production.
 */
import { usernameKey } from '@la-tour/shared';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPrisma } from '../src/db.ts';
import { createInitialSave } from '../src/save/service.ts';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('✖ Le seed du compte admin est réservé au développement.');
  process.exit(1);
}

const username = process.env.ADMIN_USERNAME?.trim() || 'admin';
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('✖ ADMIN_PASSWORD est vide : renseignez-le dans .env (voir .env.example).');
  process.exit(1);
}

const prisma = createPrisma(config.DATABASE_URL);
try {
  const passwordHash = await hashPassword(password);
  const key = usernameKey(username);
  const user = await prisma.$transaction(async (tx) => {
    const admin = await tx.user.upsert({
      where: { usernameKey: key },
      update: { passwordHash, role: 'admin' },
      create: { username, usernameKey: key, passwordHash, role: 'admin' },
    });
    if (!(await tx.save.findUnique({ where: { userId: admin.id } })))
      await createInitialSave(tx, admin.id);
    return admin;
  });
  console.log(`✔ Compte admin prêt : « ${user.username} » (id ${user.id}).`);
} finally {
  await prisma.$disconnect();
}
