import { randomBytes } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resetEnvCache } from '../../core/env.js';

import { decrypt, decryptJson, encrypt, encryptJson, resetEncryptionKeyCache } from './encryption.js';

/**
 * Tests unitaires du module encryption.
 *
 * Stratégie : pose une clé déterministe en env, vérifie round-trip, vérifie
 * détection de corruption, vérifie qu'une mauvaise clé est rejetée.
 */

const TEST_KEY = randomBytes(32).toString('base64');

describe('encryption AES-256-GCM', () => {
  beforeAll(() => {
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['BACKEND_PORT'] = '0';
    process.env['BACKEND_HOST'] = '127.0.0.1';
    process.env['DATABASE_URL'] ??= 'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379/15';
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64);
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64);
    process.env['ENCRYPTION_KEY_BRIDGES'] = TEST_KEY;
    resetEnvCache();
    resetEncryptionKeyCache();
  });

  afterEach(() => {
    // Garder l'env stable entre les tests
  });

  describe('encrypt/decrypt round-trip', () => {
    it('chiffre puis déchiffre une string ASCII simple', () => {
      const plaintext = 'hello world';
      const blob = encrypt(plaintext);
      expect(decrypt(blob)).toBe(plaintext);
    });

    it("chiffre puis déchiffre de l'UTF-8 (accents, emojis)", () => {
      const plaintext = 'café ☕ — éphémère 🎉 «français»';
      const blob = encrypt(plaintext);
      expect(decrypt(blob)).toBe(plaintext);
    });

    it('chiffre puis déchiffre du JSON', () => {
      const obj = { token: 'abc-123', refreshToken: 'def-456', expiresAt: 1234567890 };
      const blob = encryptJson(obj);
      expect(decryptJson(blob)).toEqual(obj);
    });

    it('chiffre puis déchiffre un blob de 10KB', () => {
      const plaintext = 'x'.repeat(10_000);
      const blob = encrypt(plaintext);
      expect(decrypt(blob)).toBe(plaintext);
    });

    it('chiffre puis déchiffre une string vide', () => {
      const blob = encrypt('');
      expect(decrypt(blob)).toBe('');
    });
  });

  describe('layout du blob', () => {
    it("produit un blob d'au moins IV(12) + authTag(16) bytes", () => {
      const blob = encrypt('a');
      expect(blob.length).toBeGreaterThanOrEqual(28);
    });

    it('produit un blob différent à chaque chiffrement (IV random)', () => {
      const a = encrypt('same input');
      const b = encrypt('same input');
      expect(a.equals(b)).toBe(false); // IV différent → ciphertext différent
      expect(decrypt(a)).toBe('same input');
      expect(decrypt(b)).toBe('same input');
    });
  });

  describe('détection de corruption', () => {
    it("throw si l'authTag est corrompu", () => {
      const blob = encrypt('secret');
      // Flip un bit dans l'authTag (offset 12-27)
      blob[15] = (blob[15]! ^ 0x01);
      expect(() => decrypt(blob)).toThrow();
    });

    it('throw si le ciphertext est corrompu', () => {
      const blob = encrypt('secret');
      // Flip un bit dans le ciphertext (offset >= 28)
      blob[blob.length - 1] = (blob[blob.length - 1]! ^ 0x01);
      expect(() => decrypt(blob)).toThrow();
    });

    it("throw si l'IV est altéré", () => {
      const blob = encrypt('secret');
      blob[0] = (blob[0]! ^ 0x01);
      expect(() => decrypt(blob)).toThrow();
    });

    it('throw si le blob est trop court', () => {
      try {
        decrypt(Buffer.from([1, 2, 3]));
        expect.fail('decrypt should have thrown');
      } catch (err) {
        const e = err as { code?: string; details?: { reason?: string } };
        expect(e.code).toBe('INTERNAL_ERROR');
        expect(e.details?.reason).toBe('encrypted_blob_too_short');
      }
    });
  });

  describe('mauvaise clé', () => {
    it('decrypt avec une autre clé throw', () => {
      const blob = encrypt('secret');
      // Change la clé
      process.env['ENCRYPTION_KEY_BRIDGES'] = randomBytes(32).toString('base64');
      resetEnvCache();
      resetEncryptionKeyCache();
      expect(() => decrypt(blob)).toThrow();
      // Restaurer
      process.env['ENCRYPTION_KEY_BRIDGES'] = TEST_KEY;
      resetEnvCache();
      resetEncryptionKeyCache();
    });
  });

  describe('decryptJson', () => {
    it('round-trip complet objet imbriqué', () => {
      const obj = { a: 1, b: { c: [1, 2, 3], d: 'hello' }, e: null };
      expect(decryptJson(encryptJson(obj))).toEqual(obj);
    });

    it("throw si le payload déchiffré n'est pas un JSON valide", () => {
      const blob = encrypt('not-json{');
      try {
        decryptJson(blob);
        expect.fail('decryptJson should have thrown');
      } catch (err) {
        const e = err as { code?: string; details?: { reason?: string } };
        expect(e.code).toBe('INTERNAL_ERROR');
        expect(e.details?.reason).toBe('decrypted_payload_not_json');
      }
    });
  });
});
