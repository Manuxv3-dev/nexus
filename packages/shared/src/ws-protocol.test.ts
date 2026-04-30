import { describe, expect, it } from 'vitest';

import { WsEventSchema } from './ws-protocol.js';

describe('WsEventSchema', () => {
  it('valide un presence:update conforme', () => {
    const event = {
      type: 'presence:update',
      payload: {
        userId: '00000000-0000-4000-8000-000000000001',
        status: 'online',
      },
      timestamp: Date.now(),
    };
    expect(WsEventSchema.parse(event)).toEqual(event);
  });

  it('refuse un type inconnu', () => {
    expect(() =>
      WsEventSchema.parse({
        type: 'nope',
        payload: {},
        timestamp: 0,
      }),
    ).toThrow();
  });

  it('refuse un statut de présence invalide', () => {
    expect(() =>
      WsEventSchema.parse({
        type: 'presence:update',
        payload: { userId: '00000000-0000-4000-8000-000000000001', status: 'maybe' },
        timestamp: 0,
      }),
    ).toThrow();
  });
});
