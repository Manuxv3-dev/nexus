import { describe, expect, it } from 'vitest';

import { buildDeepLinkUrl } from './pushDeepLink';

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
