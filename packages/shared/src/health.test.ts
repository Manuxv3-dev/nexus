import { describe, expect, it } from 'vitest';

import { HealthStatusSchema } from './health.js';

describe('HealthStatusSchema', () => {
  it('valide un statut nominal', () => {
    const sample = {
      status: 'ok' as const,
      version: '0.0.0',
      uptimeSeconds: 42,
      timestamp: '2026-04-30T10:00:00.000Z',
      dependencies: {
        postgres: 'ok' as const,
        redis: 'ok' as const,
      },
    };

    expect(HealthStatusSchema.parse(sample)).toEqual(sample);
  });

  it('refuse un uptime négatif', () => {
    const sample = {
      status: 'ok',
      version: '0.0.0',
      uptimeSeconds: -1,
      timestamp: '2026-04-30T10:00:00.000Z',
      dependencies: { postgres: 'ok', redis: 'ok' },
    };

    expect(() => HealthStatusSchema.parse(sample)).toThrow();
  });

  it('refuse un statut invalide', () => {
    const sample = {
      status: 'sleeping',
      version: '0.0.0',
      uptimeSeconds: 0,
      timestamp: '2026-04-30T10:00:00.000Z',
      dependencies: { postgres: 'ok', redis: 'ok' },
    };

    expect(() => HealthStatusSchema.parse(sample)).toThrow();
  });
});
