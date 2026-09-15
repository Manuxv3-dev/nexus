/**
 * `describeUserNotMember` — le refus serveur « pas membre » devient une phrase
 * (cf. ticket 77950250).
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { describeUserNotMember } from './userNotMember';

const MEMBERS = [
  { userId: 'u-manu', displayName: 'Manu' },
  { userId: 'u-lea', displayName: 'Léa' },
];

function notMember(userId: string): ApiError {
  return new ApiError(400, {
    code: 'VALIDATION_ERROR',
    message: 'Validation error',
    details: { reason: 'user_not_member', userId },
  });
}

describe('describeUserNotMember', () => {
  it('nomme la personne quand la liste (périmée) des membres la connaît encore', () => {
    // C'est précisément le cas réel : le select proposait quelqu'un que le
    // cache tenait encore pour membre. Son nom y est donc, autant le dire.
    expect(describeUserNotMember(notMember('u-lea'), MEMBERS)).toBe(
      'Léa ne fait plus partie du groupe.',
    );
  });

  it('reste générique quand la personne est déjà sortie de la liste', () => {
    expect(describeUserNotMember(notMember('u-inconnu'), MEMBERS)).toBe(
      'Cette personne ne fait plus partie du groupe.',
    );
    expect(describeUserNotMember(notMember('u-lea'), undefined)).toBe(
      'Cette personne ne fait plus partie du groupe.',
    );
  });

  it('ne reconnaît que ce refus-là', () => {
    expect(
      describeUserNotMember(
        new ApiError(400, { code: 'VALIDATION_ERROR', message: 'Validation error' }),
        MEMBERS,
      ),
    ).toBeNull();
    expect(
      describeUserNotMember(
        new ApiError(400, {
          code: 'VALIDATION_ERROR',
          message: 'Validation error',
          details: { reason: 'ambiguous_token_sources' },
        }),
        MEMBERS,
      ),
    ).toBeNull();
    expect(
      describeUserNotMember(
        new ApiError(403, {
          code: 'PERMISSION_DENIED',
          message: 'Forbidden',
          details: { reason: 'user_not_member', userId: 'u-lea' },
        }),
        MEMBERS,
      ),
    ).toBeNull();
    expect(describeUserNotMember(new Error('réseau'), MEMBERS)).toBeNull();
    expect(describeUserNotMember(null, MEMBERS)).toBeNull();
  });
});
