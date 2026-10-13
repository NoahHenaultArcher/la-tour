import type { FastifyRequest } from 'fastify';

export interface RateLimit {
  max: number;
  timeWindow: string;
}

export interface RateLimits {
  /** Inscriptions par adresse IP. */
  register: RateLimit;
  /** Tentatives de connexion par adresse IP. */
  login: RateLimit;
  /** Actions qui modifient la sauvegarde, par compte. */
  sensitive: RateLimit;
  /** Actions de combat (plus fréquentes, surtout en mode auto), par compte. */
  combat: RateLimit;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  register: { max: 10, timeWindow: '1 hour' },
  login: { max: 10, timeWindow: '1 minute' },
  sensitive: { max: 120, timeWindow: '1 minute' },
  combat: { max: 300, timeWindow: '1 minute' },
};

/** Limite par compte connecté (ou par IP à défaut). */
export function perUser(limit: RateLimit) {
  return { ...limit, keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip };
}
