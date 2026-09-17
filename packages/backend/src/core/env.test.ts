import { afterEach, describe, expect, it } from 'vitest';

import { setTestEnv } from '../test/helpers.js';

import { loadEnv, resetEnvCache } from './env.js';

/**
 * Format TTL de `JWT_REFRESH_TTL`/`JWT_REFRESH_TTL_SHORT` (revue de code du
 * ticket 04a2b4f7) : avant ce `.refine()`, une valeur mal formée (ex. une
 * faute de frappe dans un `.env`) passait `loadEnv()` sans broncher — c'est
 * `parseTtlMs` (routes/auth/service.ts), appelé seulement au premier
 * login/register/refresh, qui aurait alors levé une `Error` non typée,
 * remontée en 500 au pire moment (une requête utilisateur) plutôt qu'un
 * refus de démarrage explicite du serveur. Les deux DOIVENT rejeter/accepter
 * exactement les mêmes valeurs (cf. commentaire de `TTL_FORMAT_RE`).
 */
describe('loadEnv — format TTL des refresh tokens', () => {
  afterEach(() => {
    delete process.env['JWT_REFRESH_TTL'];
    delete process.env['JWT_REFRESH_TTL_SHORT'];
    resetEnvCache();
  });

  it('accepte les formats <entier><unité s|m|h|d> — mêmes unités que parseTtlMs', () => {
    setTestEnv();
    process.env['JWT_REFRESH_TTL'] = '45d';
    process.env['JWT_REFRESH_TTL_SHORT'] = '3h';
    resetEnvCache();

    const env = loadEnv();

    expect(env.JWT_REFRESH_TTL).toBe('45d');
    expect(env.JWT_REFRESH_TTL_SHORT).toBe('3h');
  });

  it('refuse un JWT_REFRESH_TTL mal formé au démarrage plutôt qu’au premier login', () => {
    setTestEnv();
    process.env['JWT_REFRESH_TTL'] = '30 days';
    resetEnvCache();

    expect(() => loadEnv()).toThrow();
  });

  it('refuse un JWT_REFRESH_TTL_SHORT mal formé au démarrage', () => {
    setTestEnv();
    process.env['JWT_REFRESH_TTL_SHORT'] = 'bientot';
    resetEnvCache();

    expect(() => loadEnv()).toThrow();
  });

  it('refuse une unité inconnue (ex. semaines "w"), non supportée par parseTtlMs', () => {
    setTestEnv();
    process.env['JWT_REFRESH_TTL'] = '2w';
    resetEnvCache();

    expect(() => loadEnv()).toThrow();
  });
});
