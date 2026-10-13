/**
 * Prépare la base de test : schéma PostgreSQL « test » (séparé des données de développement),
 * migré avant les tests. Si la base est injoignable, les tests d'intégration sont ignorés.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string | null;
  }
}

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function setup(project: TestProject): void {
  const envFile = path.resolve(serverDir, '../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    console.warn('\n⚠ DATABASE_URL absent : tests d’intégration du serveur ignorés.\n');
    project.provide('testDatabaseUrl', null);
    return;
  }
  const url = new URL(base);
  url.searchParams.set('schema', 'test');
  try {
    execSync('npx prisma migrate deploy', {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    project.provide('testDatabaseUrl', url.toString());
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    console.warn(
      `\n⚠ Base de test injoignable (pnpm db:up ?) : tests d’intégration ignorés.\n${output}\n`,
    );
    project.provide('testDatabaseUrl', null);
  }
}
