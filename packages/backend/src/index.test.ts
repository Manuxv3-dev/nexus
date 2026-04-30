import { describe, expect, it } from 'vitest';

import { buildPlaceholderHealth } from './index.js';

describe('buildPlaceholderHealth', () => {
  it('retourne un statut conforme au schéma partagé', () => {
    const h = buildPlaceholderHealth();
    expect(h.status).toBe('ok');
    expect(h.version).toBeTypeOf('string');
    expect(h.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(h.dependencies.postgres).toBe('unknown');
    expect(h.dependencies.redis).toBe('unknown');
  });
});
