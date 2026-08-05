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

import { generateResetToken, hashRefreshToken, hashResetToken } from './service.js';

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
