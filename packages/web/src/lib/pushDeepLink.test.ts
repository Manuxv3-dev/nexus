import { describe, expect, it } from 'vitest';

import { buildDeepLinkUrl, readPushDeepLinkParams } from './pushDeepLink';

describe('buildDeepLinkUrl', () => {
  it('builds an /app URL with groupId, pane and sourceId query params', () => {
    const url = buildDeepLinkUrl({ groupId: 'g1', pane: 'event', sourceId: 'e1' });
    expect(url).toBe('/app?groupId=g1&pane=event&sourceId=e1');
  });

  it('omits sourceId from the query string when missing (no literal "null")', () => {
    const url = buildDeepLinkUrl({ groupId: 'g1', pane: 'expense', sourceId: null });
    expect(url).toBe('/app?groupId=g1&pane=expense');
  });

  it('falls back to bare /app when groupId is missing', () => {
    const url = buildDeepLinkUrl({ groupId: null, pane: 'event', sourceId: 'e1' });
    expect(url).toBe('/app');
  });

  it('falls back to bare /app for the home pane', () => {
    const url = buildDeepLinkUrl({ groupId: 'g1', pane: 'home', sourceId: null });
    expect(url).toBe('/app');
  });
});

// `readPushDeepLinkParams` est partagée par `AppShell` (desktop) et
// `MobileShell` (mobile, cf. MAN-151) : couverte ici en isolation (pure
// fonction, pas besoin de monter un shell) en complément des tests
// d'intégration `AppShell.pushDeepLink.test.tsx` /
// `MobileShell.pushDeepLink.test.tsx`, qui vérifient le câblage complet avec
// le router et le mécanisme `pendingOpen`.
describe('readPushDeepLinkParams', () => {
  it('parses groupId, pane and sourceId from the query string', () => {
    expect(readPushDeepLinkParams('?groupId=g1&pane=event&sourceId=e1')).toEqual({
      groupId: 'g1',
      pane: 'event',
      sourceId: 'e1',
    });
  });

  it('defaults sourceId to null when absent', () => {
    expect(readPushDeepLinkParams('?groupId=g1&pane=poll')).toEqual({
      groupId: 'g1',
      pane: 'poll',
      sourceId: null,
    });
  });

  it('returns null when groupId is missing', () => {
    expect(readPushDeepLinkParams('?pane=event')).toBeNull();
  });

  it('returns null for an empty query string', () => {
    expect(readPushDeepLinkParams('')).toBeNull();
  });

  it.each(['home', 'chat', 'group_home', 'unknown'])(
    'returns null for a pane not targetable by a push (%s)',
    (pane) => {
      expect(readPushDeepLinkParams(`?groupId=g1&pane=${pane}`)).toBeNull();
    },
  );
});
