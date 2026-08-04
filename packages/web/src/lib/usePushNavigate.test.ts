import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));

import { usePushNavigate } from './usePushNavigate';

/** Simule (ou retire) `navigator.serviceWorker` — même pattern que `push.test.ts`. */
function defineServiceWorker(sw: EventTarget | undefined) {
  if (sw === undefined) {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    return;
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: sw,
    configurable: true,
    writable: true,
  });
}

function dispatchMessage(sw: EventTarget, data: unknown) {
  sw.dispatchEvent(new MessageEvent('message', { data }));
}

describe('usePushNavigate', () => {
  afterEach(() => {
    navigateMock.mockClear();
    defineServiceWorker(undefined);
  });

  it('navigue vers /app avec les query params du target sur un message push-navigate', () => {
    const sw = new EventTarget();
    defineServiceWorker(sw);
    renderHook(() => usePushNavigate());

    dispatchMessage(sw, {
      type: 'push-navigate',
      target: { groupId: 'g1', pane: 'event', sourceId: 's1' },
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app',
      search: { groupId: 'g1', pane: 'event', sourceId: 's1' },
    });
  });

  it('omet sourceId de la recherche quand absent (pas de littéral "null")', () => {
    const sw = new EventTarget();
    defineServiceWorker(sw);
    renderHook(() => usePushNavigate());

    dispatchMessage(sw, {
      type: 'push-navigate',
      target: { groupId: 'g1', pane: 'expense', sourceId: null },
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app',
      search: { groupId: 'g1', pane: 'expense' },
    });
  });

  it('navigue vers /app nu quand le target ne pointe pas vers un item précis (pane home)', () => {
    const sw = new EventTarget();
    defineServiceWorker(sw);
    renderHook(() => usePushNavigate());

    dispatchMessage(sw, {
      type: 'push-navigate',
      target: { groupId: null, pane: 'home', sourceId: null },
    });

    expect(navigateMock).toHaveBeenCalledWith({ to: '/app' });
  });

  it('ignore un message dont le type n’est pas push-navigate', () => {
    const sw = new EventTarget();
    defineServiceWorker(sw);
    renderHook(() => usePushNavigate());

    dispatchMessage(sw, { type: 'some-other-type', target: { groupId: 'g1', pane: 'event' } });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('ne s’abonne à rien si navigator.serviceWorker est indisponible', () => {
    defineServiceWorker(undefined);

    expect(() => renderHook(() => usePushNavigate())).not.toThrow();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('se désabonne au démontage (pas d’appel après unmount)', () => {
    const sw = new EventTarget();
    defineServiceWorker(sw);
    const { unmount } = renderHook(() => usePushNavigate());
    unmount();

    dispatchMessage(sw, {
      type: 'push-navigate',
      target: { groupId: 'g1', pane: 'event', sourceId: 's1' },
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
