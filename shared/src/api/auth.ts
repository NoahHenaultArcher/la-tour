import { z } from 'zod';

export const USERNAME_RULES = { min: 3, max: 20, pattern: /^[A-Za-z0-9_-]+$/ } as const;
export const PASSWORD_RULES = { min: 8, max: 128 } as const;

/** Pseudo : 3 à 20 caractères, lettres sans accent, chiffres, « _ » et « - ». */
export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_RULES.min)
  .max(USERNAME_RULES.max)
  .regex(USERNAME_RULES.pattern);

export const passwordSchema = z.string().min(PASSWORD_RULES.min).max(PASSWORD_RULES.max);

export const registerBodySchema = z.strictObject({
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

/** À la connexion, on ne révèle pas les règles : seule la taille est bornée. */
export const loginBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(USERNAME_RULES.max),
  password: z.string().min(1).max(PASSWORD_RULES.max),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Clé d'unicité d'un pseudo : « Noah » et « noah » sont le même compte. */
export function usernameKey(username: string): string {
  return username.trim().toLowerCase();
}

export interface UserDto {
  id: string;
  username: string;
  role: 'player' | 'admin';
}
