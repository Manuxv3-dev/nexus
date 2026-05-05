import { randomBytes, timingSafeEqual } from 'node:crypto';

import { AppError } from './errors.js';

import type { FastifyRequest } from 'fastify';

/**
 * Protection CSRF — pattern double-submit cookie (cf. ADR-015).
 *
 * Le mode web pose deux cookies au login/refresh :
 *  - `nexus_refresh` : httpOnly + Secure + SameSite=Strict (refresh token)
 *  - `nexus_csrf`    : Secure + SameSite=Strict, lisible JS (csrf token)
 *
 * Sur les requêtes mutating (refresh, logout en mode web), le client doit
 * fournir un header `X-CSRF-Token` dont la valeur correspond à celle du
 * cookie `nexus_csrf`. Un attaquant CSRF cross-origin ne peut pas lire le
 * cookie pour forger ce header → blocage.
 *
 * `SameSite=Strict` bloque déjà la plupart des attaques modernes ; ce
 * double-submit est la ceinture en plus des bretelles (cf. OWASP CSRF
 * cheat sheet 2024 + recommandation pour les sous-domaines compromis).
 */

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'nexus_csrf';

/**
 * Génère un token CSRF cryptographiquement aléatoire (32 bytes hex).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Vérifie que le header `X-CSRF-Token` correspond au cookie `nexus_csrf`.
 * Throw `AUTH_CSRF_MISMATCH` (403) sinon.
 *
 * Comparaison constant-time pour éviter les timing attacks (faible
 * exploitation possible sur 32 bytes mais autant rester propre).
 */
export function validateCsrf(req: FastifyRequest): void {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
    .cookies;
  const cookieValue = cookies?.[CSRF_COOKIE];
  const headerRaw = req.headers[CSRF_HEADER];
  const headerValue = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

  if (!cookieValue || !headerValue) {
    throw new AppError('AUTH_CSRF_MISMATCH', { reason: 'missing' });
  }

  // Comparaison constant-time : les deux Buffer doivent avoir la même longueur
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('AUTH_CSRF_MISMATCH');
  }
}
