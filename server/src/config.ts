import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  // Hébergeurs (Render…) : ils imposent le port via PORT, prioritaire sur SERVER_PORT.
  PORT: z.coerce.number().int().positive().optional(),
  // 127.0.0.1 en local ; 0.0.0.0 chez un hébergeur pour accepter les connexions extérieures.
  HOST: z.string().min(1).default('127.0.0.1'),
  // Derrière le proxy d'un hébergeur : l'IP du joueur est lue dans X-Forwarded-For.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
