/**
 * Le token d'accès porte l'identité de session (`sid`, cf. abf71bf4).
 *
 * `POST /push/subscribe` doit savoir de quelle session il vient pour y lier
 * l'abonnement — et le seul chose que la route tient, c'est le JWT d'accès.
 * `{ sub, groupIds }` ne suffisait pas. Le claim est optionnel : un token
 * émis avant le déploiement vit 15 minutes et est refait au prochain refresh,
 * avec `sid` cette fois ; `verifyAccessToken` rend `null` en attendant.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv } from '../../test/helpers.js';

// Même raison que `service.test.ts` : `core/logger.ts` charge l'env au
// chargement du module.
vi.mock('../../core/email.js', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../../core/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import type * as ServiceModule from './service.js';

let signAccessToken: typeof ServiceModule.signAccessToken;
let verifyAccessToken: typeof ServiceModule.verifyAccessToken;

beforeAll(async () => {
  setTestEnv();
  const { resetEnvCache } = await import('../../core/env.js');
  resetEnvCache();
  ({ signAccessToken, verifyAccessToken } = await import('./service.js'));
});

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';

describe('token d’accès — identité de session', () => {
  it('porte `sid` et le rend à la vérification', () => {
    const token = signAccessToken(USER, ['g1'], SESSION);

    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe(USER);
    expect(payload.groupIds).toEqual(['g1']);
    expect(payload.sid).toBe(SESSION);
  });

  it('rend `sid` à null pour un token qui n’en porte pas — émis avant le déploiement', () => {
    const token = signAccessToken(USER, [], null);

    expect(verifyAccessToken(token).sid).toBeNull();
  });
});
