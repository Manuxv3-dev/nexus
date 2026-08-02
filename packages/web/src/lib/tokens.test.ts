import { describe, expect, it } from 'vitest';

import { AVATAR_PALETTE, avatarColor } from './tokens';

describe('avatarColor', () => {
  it('renvoie toujours une couleur de la palette', () => {
    for (const seed of ['alice', 'bob', 'charlie', '', 'a-very-long-user-id-1234567890']) {
      expect(AVATAR_PALETTE).toContain(avatarColor(seed));
    }
  });

  it('est déterministe pour un même seed', () => {
    expect(avatarColor('manu@example.com')).toBe(avatarColor('manu@example.com'));
  });

  it('varie selon le seed (pas de collision systématique)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => avatarColor(s)));
    expect(colors.size).toBeGreaterThan(1);
  });
});
