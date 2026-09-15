import { describe, expect, it, vi } from 'vitest';

// `service.ts` importe `core/email.ts` et `core/logger.ts` (pour
// `requestPasswordReset`) — or `core/logger.ts` appelle `loadEnv()` de façon
// EAGER au chargement du module (`export const loggerOptions = buildOptions()`).
// Ce fichier est un test unitaire pur (pas de `setTestEnv()`/DB) : sans ces
// mocks, importer `./service.js` ferait planter `loadEnv()` (env vars requises
// absentes) avant même d'exécuter un test. Cf. `core/email.test.ts` pour le
// même pattern.
vi.mock('../../core/email.js', () => ({
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../../core/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import {
  classifyRevokedRefreshToken,
  generateResetToken,
  hashRefreshToken,
  hashResetToken,
  REFRESH_ROTATION_GRACE_MS,
} from './service.js';

/**
 * Tests unitaires purs (pas de DB) pour les helpers de jeton de reset
 * password. `generateRefreshToken`/`hashRefreshToken` sont déjà exercés
 * indirectement par les tests d'intégration de auth.test.ts ; ces
 * fonctions-ci n'ont pas d'équivalent unitaire dédié avant ce fichier.
 */
describe('generateResetToken', () => {
  it('renvoie une valeur au format UUID', () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('renvoie des valeurs différentes à chaque appel', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).not.toBe(b);
  });
});

describe('hashResetToken', () => {
  it('est déterministe : même input → même output', () => {
    const raw = 'a-fixed-raw-token';
    expect(hashResetToken(raw)).toBe(hashResetToken(raw));
  });

  it('produit un hash SHA-256 hexadécimal (64 caractères hex)', () => {
    const hash = hashResetToken('another-raw-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit le même résultat que hashRefreshToken pour un même input', () => {
    const raw = 'shared-input-token';
    expect(hashResetToken(raw)).toBe(hashRefreshToken(raw));
  });
});

/**
 * `classifyRevokedRefreshToken` (ADR-040, MAN-… fenêtre de grâce sur la
 * réutilisation d'un refresh token) : fonction pure, testée ici sans DB. Le
 * handler `/auth/refresh` (routes/auth/index.ts) ne fait que router sur son
 * verdict — cf. sa JSDoc dans service.ts pour la définition complète des
 * trois branches.
 */
describe('classifyRevokedRefreshToken', () => {
  const NOW = new Date('2026-09-15T12:00:00.000Z');
  /** Remplacement vivant par défaut : jamais consommé, expire loin dans le futur. */
  const aliveReplacement = {
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 3600_000),
  };

  it("révocation délibérée (replacedById nul) → 'reuse', même à l'instant même", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: NOW,
      replacedById: null,
      replacement: null,
      now: NOW,
    });
    expect(verdict).toBe('reuse');
  });

  it("révocation délibérée ancienne (logout-all d'il y a des jours) → 'reuse'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - 10 * 24 * 3600_000),
      replacedById: null,
      replacement: null,
      now: NOW,
    });
    expect(verdict).toBe('reuse');
  });

  it("révoqué par rotation, dans la fenêtre, remplacement vivant → 'grace_recover'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - (REFRESH_ROTATION_GRACE_MS - 1)),
      replacedById: 'replacement-id',
      replacement: aliveReplacement,
      now: NOW,
    });
    expect(verdict).toBe('grace_recover');
  });

  it("révoqué par rotation, dans la fenêtre, remplacement déjà consommé → 'grace_reject'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - 1000),
      replacedById: 'replacement-id',
      replacement: { revokedAt: NOW, expiresAt: aliveReplacement.expiresAt },
      now: NOW,
    });
    expect(verdict).toBe('grace_reject');
  });

  it("révoqué par rotation, dans la fenêtre, remplacement expiré → 'grace_reject'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - 1000),
      replacedById: 'replacement-id',
      replacement: { revokedAt: null, expiresAt: new Date(NOW.getTime() - 1) },
      now: NOW,
    });
    expect(verdict).toBe('grace_reject');
  });

  it("révoqué par rotation, dans la fenêtre, remplacement introuvable (défensif) → 'grace_reject'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - 1000),
      replacedById: 'replacement-id',
      replacement: undefined,
      now: NOW,
    });
    expect(verdict).toBe('grace_reject');
  });

  it("révoqué par rotation, exactement REFRESH_ROTATION_GRACE_MS → hors fenêtre → 'reuse'", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - REFRESH_ROTATION_GRACE_MS),
      replacedById: 'replacement-id',
      replacement: aliveReplacement,
      now: NOW,
    });
    expect(verdict).toBe('reuse');
  });

  it("révoqué par rotation, 1 ms après la fenêtre → 'reuse' même remplacement vivant", () => {
    const verdict = classifyRevokedRefreshToken({
      revokedAt: new Date(NOW.getTime() - (REFRESH_ROTATION_GRACE_MS + 1)),
      replacedById: 'replacement-id',
      replacement: aliveReplacement,
      now: NOW,
    });
    expect(verdict).toBe('reuse');
  });
});
