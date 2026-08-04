import { describe, expect, it } from 'vitest';

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
