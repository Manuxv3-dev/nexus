import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import {
  getPushSubscriptionStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from './push';

vi.mock('./api', () => ({
  api: vi.fn(),
}));

const mockedApi = vi.mocked(api) as any;

/** Simule (ou retire) le support Push API sur `window`. */
function definePushManagerSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(window, 'PushManager', {
      value: class {},
      configurable: true,
      writable: true,
    });
  } else {
    Reflect.deleteProperty(window, 'PushManager');
  }
}

/** Simule (ou retire) `navigator.serviceWorker`. */
function defineServiceWorker(sw: any) {
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

describe('push', () => {
  afterEach(() => {
    vi.clearAllMocks();
    defineServiceWorker(undefined);
    definePushManagerSupport(false);
  });

  describe('isPushSupported', () => {
    it('test_isPushSupported_false_when_no_serviceWorker', () => {
      defineServiceWorker(undefined);
      definePushManagerSupport(true);

      expect(isPushSupported()).toBe(false);
    });

    it('test_isPushSupported_true_when_supported', () => {
      defineServiceWorker({ register: vi.fn() });
      definePushManagerSupport(true);

      expect(isPushSupported()).toBe(true);
    });
  });

  describe('subscribeToPush', () => {
    it('test_subscribeToPush_registers_sw_and_calls_pushManager_subscribe', async () => {
      const subscription = {
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      };
      const subscribe = vi.fn().mockResolvedValue(subscription);
      const registration = { pushManager: { subscribe, getSubscription: vi.fn() } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      mockedApi.mockImplementation((opts: any) => {
        if (opts.path === '/push/vapid-public-key') return Promise.resolve({ publicKey: 'AAAA' });
        if (opts.path === '/push/subscribe') return Promise.resolve({ ok: true });
        return Promise.reject(new Error(`unexpected api call: ${String(opts.path)}`));
      });

      await subscribeToPush();

      expect(register).toHaveBeenCalledWith('/sw-push.js');
      expect(subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          userVisibleOnly: true,
          applicationServerKey: expect.any(Uint8Array),
        }),
      );
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/push/vapid-public-key',
        }),
      );
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/push/subscribe',
          body: {
            endpoint: 'https://push.example/abc',
            keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
          },
        }),
      );
    });
  });

  describe('unsubscribeFromPush', () => {
    it('test_unsubscribeFromPush_calls_delete_then_browser_unsubscribe', async () => {
      const callOrder: string[] = [];
      const subscription = {
        endpoint: 'https://push.example/abc',
        unsubscribe: vi.fn().mockImplementation(() => {
          callOrder.push('browser-unsubscribe');
          return Promise.resolve(true);
        }),
      };
      const getSubscription = vi.fn().mockResolvedValue(subscription);
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      mockedApi.mockImplementation(() => {
        callOrder.push('api-delete');
        return Promise.resolve({ ok: true });
      });

      await unsubscribeFromPush();

      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          path: '/push/subscribe',
          body: { endpoint: 'https://push.example/abc' },
        }),
      );
      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['api-delete', 'browser-unsubscribe']);
    });

    it('test_unsubscribeFromPush_noop_when_no_existing_subscription', async () => {
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      await unsubscribeFromPush();

      expect(mockedApi).not.toHaveBeenCalled();
    });
  });

  describe('helpers no-op when unsupported', () => {
    it('test_helpers_noop_when_unsupported', async () => {
      defineServiceWorker(undefined);
      definePushManagerSupport(false);
      expect(isPushSupported()).toBe(false);

      await expect(subscribeToPush()).resolves.toBeUndefined();
      await expect(unsubscribeFromPush()).resolves.toBeUndefined();
      expect(mockedApi).not.toHaveBeenCalled();
    });
  });

  describe('getPushSubscriptionStatus', () => {
    it('renvoie "unsupported" si le navigateur ne supporte pas Push', async () => {
      defineServiceWorker(undefined);
      definePushManagerSupport(false);

      await expect(getPushSubscriptionStatus()).resolves.toBe('unsupported');
    });

    it('renvoie "subscribed" si une subscription existe déjà', async () => {
      const getSubscription = vi.fn().mockResolvedValue({ endpoint: 'https://push.example/abc' });
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      await expect(getPushSubscriptionStatus()).resolves.toBe('subscribed');
    });

    it('renvoie "not-subscribed" sinon', async () => {
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      await expect(getPushSubscriptionStatus()).resolves.toBe('not-subscribed');
    });
  });
});
