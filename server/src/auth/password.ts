import argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

let dummyHash: Promise<string> | null = null;

/**
 * Vérifie un mot de passe. Sans compte (hash null), on vérifie quand même contre un hash factice :
 * la réponse prend le même temps, ce qui ne révèle pas si le pseudo existe.
 */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (hash === null) {
    dummyHash ??= hashPassword('mot-de-passe-factice');
    await argon2.verify(await dummyHash, password);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
