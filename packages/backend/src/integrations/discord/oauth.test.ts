import { beforeAll, describe, expect, it } from 'vitest';

import { resetEnvCache } from '../../core/env.js';

import { buildInstallUrl, verifyState } from './oauth.js';

/**
 * Tests unitaires du module oauth.ts.
 *
 * Couverture :
 *  - signature/vérif state (HMAC)
 *  - état expiré
 *  - état corrompu
 *  - URL d'install bien formée
 *
 * `exchangeCodeForGuildInfo` n'est pas testé ici (fait un fetch réseau,
 * couverture en E2E manuel + en mock-fetch plus tard si besoin).
 */

describe('Discord OAuth signed state', () => {
  beforeAll(() => {
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['BACKEND_PORT'] = '0';
    process.env['BACKEND_HOST'] = '127.0.0.1';
    process.env['DATABASE_URL'] ??= 'postgres://nexus:nexus_dev_password@127.0.0.1:5432/nexus_test';
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379/15';
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64);
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64);
    process.env['DISCORD_CLIENT_ID'] = 'test-client-id';
    process.env['DISCORD_CLIENT_SECRET'] = 'test-client-secret';
    process.env['DISCORD_BOT_PERMISSIONS'] = '274877975552';
    process.env['PUBLIC_BASE_URL'] = 'http://127.0.0.1:3000';
    resetEnvCache();
  });

  it('buildInstallUrl renvoie une URL valide avec state signé', () => {
    const url = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    expect(url).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?/);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('scope')).toBe('bot applications.commands');
    expect(parsed.searchParams.get('permissions')).toBe('274877975552');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/api/v1/messaging/discord/oauth/callback',
    );
    expect(parsed.searchParams.get('state')).toBeTruthy();
  });

  it('verifyState round-trip OK', () => {
    const url = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    const state = new URL(url).searchParams.get('state')!;
    const payload = verifyState(state);
    expect(payload.groupId).toBe('g-1');
    expect(payload.userId).toBe('u-1');
    expect(payload.ts).toBeTypeOf('number');
    expect(payload.nonce).toBeTypeOf('string');
  });

  it('verifyState throw si signature mismatch', () => {
    const url = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    const state = new URL(url).searchParams.get('state')!;
    // Corrompre la signature (les 8 derniers caractères hex)
    const tampered = state.slice(0, -8) + '00000000';
    expect(() => verifyState(tampered)).toThrow();
  });

  it('verifyState throw si state mal formé (pas de séparateur)', () => {
    expect(() => verifyState('no-dot-here')).toThrow();
  });

  it('verifyState throw si state vide', () => {
    expect(() => verifyState('')).toThrow();
  });

  it('verifyState détecte un payload non-JSON via signature mismatch', () => {
    // Payload arbitraire avec signature absente/fausse
    expect(() => verifyState('Zm9v.deadbeef')).toThrow();
  });

  it("verifyState throw AUTH_TOKEN_EXPIRED si state vieux de >10min", () => {
    // On signe à la main avec un ts ancien
    // (réutilise les fonctions internes via un round-trip avec patching de Date.now)
    const realNow = Date.now;
    try {
      // Date.now retourne un ts -20 min
      Date.now = (): number => realNow() - 20 * 60 * 1000;
      const url = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
      const state = new URL(url).searchParams.get('state')!;
      // Restaure Date.now
      Date.now = realNow;
      try {
        verifyState(state);
        expect.fail('verifyState should have thrown');
      } catch (err) {
        const e = err as { code?: string; details?: { reason?: string } };
        expect(e.code).toBe('AUTH_TOKEN_EXPIRED');
        expect(e.details?.reason).toBe('state_too_old');
      }
    } finally {
      Date.now = realNow;
    }
  });

  it('signatures différentes pour groupes différents (même userId)', () => {
    const url1 = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    const url2 = buildInstallUrl({ groupId: 'g-2', userId: 'u-1' });
    expect(url1).not.toBe(url2);
  });

  it('nonce différent à chaque appel pour les mêmes inputs', () => {
    const url1 = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    const url2 = buildInstallUrl({ groupId: 'g-1', userId: 'u-1' });
    expect(url1).not.toBe(url2); // nonce random → URLs différentes
  });
});
