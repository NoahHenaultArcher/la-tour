import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL doit être une URL PostgreSQL (postgresql://…)'),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
});

export type Config = z.infer<typeof envSchema>;

/** Lit et valide les variables d'environnement (fichier .env à la racine, voir .env.example). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuration invalide (voir .env.example) :\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
