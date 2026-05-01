import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Chiffrement AES-256-GCM pour les credentials des sessions bridges
 * (cf. ADR-009, J3a).
 *
 * Layout du blob chiffré (binaire, stocké en BYTEA Postgres) :
 *
 *     [ IV (12 bytes) | authTag (16 bytes) | ciphertext (n bytes) ]
 *
 * Pourquoi GCM : authenticated encryption — pas seulement confidentialité,
 * mais aussi intégrité. Toute altération du ciphertext (transit, DB
 * compromise, etc.) est détectée à la lecture (authTag invalide → throw).
 *
 * Pourquoi IV de 12 bytes : recommandation NIST SP 800-38D pour GCM
 * (96 bits = sweet spot perf/sécurité, sous-réserve de ne jamais réutiliser
 * un IV avec la même clé). On utilise `randomBytes(12)` à chaque chiffrement
 * → probabilité de collision négligeable (< 2^-32 après 2^32 messages).
 *
 * La clé est lue depuis l'env `ENCRYPTION_KEY_BRIDGES` (32 bytes en base64).
 * Elle est mise en cache à la première utilisation pour éviter de re-decode
 * à chaque appel.
 */

const IV_LENGTH = 12; // GCM standard (96 bits)
const AUTH_TAG_LENGTH = 16; // GCM standard (128 bits)

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = loadEnv();
  if (!env.ENCRYPTION_KEY_BRIDGES) {
    throw new AppError('INTERNAL_ERROR', { reason: 'ENCRYPTION_KEY_BRIDGES not set' });
  }
  const buf = Buffer.from(env.ENCRYPTION_KEY_BRIDGES, 'base64');
  if (buf.length !== 32) {
    throw new AppError('INTERNAL_ERROR', { reason: 'ENCRYPTION_KEY_BRIDGES must be 32 bytes' });
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Reset du cache de la clé. Utilisé uniquement par les tests qui
 * manipulent l'env entre les runs.
 */
export function resetEncryptionKeyCache(): void {
  cachedKey = undefined;
}

/**
 * Chiffre une string UTF-8 et renvoie un Buffer prêt à stocker en BYTEA.
 *
 * Throw `INTERNAL_ERROR` si la clé est absente ou mal formée.
 */
export function encrypt(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Déchiffre un Buffer (lu depuis BYTEA) et renvoie la string UTF-8 originale.
 *
 * Throw `INTERNAL_ERROR` si :
 *  - le blob fait moins de 28 bytes (IV + authTag minimum)
 *  - l'authTag ne matche pas (corruption ou mauvaise clé)
 */
export function decrypt(blob: Buffer): string {
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new AppError('INTERNAL_ERROR', { reason: 'encrypted_blob_too_short' });
  }
  const key = getKey();
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new AppError('INTERNAL_ERROR', { reason: 'decryption_failed' }, { cause: err });
  }
}

/**
 * Helper : chiffre un objet JSON (stringify + encrypt). Renvoie le Buffer.
 */
export function encryptJson<T>(value: T): Buffer {
  return encrypt(JSON.stringify(value));
}

/**
 * Helper : déchiffre un Buffer en objet JSON (decrypt + parse).
 *
 * Throw `INTERNAL_ERROR` si le déchiffrement échoue OU si le JSON est invalide.
 */
export function decryptJson<T>(blob: Buffer): T {
  const json = decrypt(blob);
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new AppError(
      'INTERNAL_ERROR',
      { reason: 'decrypted_payload_not_json' },
      { cause: err },
    );
  }
}
