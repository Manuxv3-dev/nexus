import { randomBytes } from 'node:crypto';

/**
 * Génère un slug court non-prédictible en base62 (cf. ADR-010).
 *
 * Default 12 chars → ~62^12 ≈ 3.2e21 combinaisons. Énumération impossible
 * même avec un attaquant capable de tester 1M req/s sur 100 ans.
 *
 * Utilisé pour :
 *  - Pages publiques (events, polls, expenses, todos, listes — cf. J5+)
 *  - Liens d'invitation à un groupe (J2)
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALPHABET_LEN = ALPHABET.length;

export function generateSlug(length = 12): string {
  if (length < 4 || length > 64) {
    throw new Error(`generateSlug: length must be between 4 and 64 (got ${length})`);
  }

  // randomBytes(length * 2) → assez d'entropie pour rejeter les bytes biaisés
  // sans avoir à reboucler. On lit byte par byte modulo 62, en rejetant les
  // bytes >= 62*4 = 248 pour éliminer le biais d'arrondi.
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (const byte of buf) {
      if (byte >= ALPHABET_LEN * 4) continue; // rejet pour éviter le biais
      out.push(ALPHABET.charAt(byte % ALPHABET_LEN));
      if (out.length >= length) break;
    }
  }
  return out.join('');
}
