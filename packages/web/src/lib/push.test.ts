import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import {
  dropDevicePushSubscription,
  getPushSubscriptionStatus,
  isPushSupported,
  readPushPreview,
  reconcilePushSubscription,
  setPushPreview,
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
    // La préférence "Aperçu" est persistée en localStorage (device-local) :
    // sans reset, un test qui la met à OFF contaminerait les suivants.
    window.localStorage.clear();
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
            previewEnabled: true,
          },
        }),
      );
    });
  });

  describe('subscribeToPush — rollback', () => {
    it('test_subscribeToPush_rolls_back_browser_subscription_when_server_fails', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      const subscription = {
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
        unsubscribe,
      };
      const subscribe = vi.fn().mockResolvedValue(subscription);
      const registration = { pushManager: { subscribe, getSubscription: vi.fn() } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      mockedApi.mockImplementation((opts: any) => {
        if (opts.path === '/push/vapid-public-key') return Promise.resolve({ publicKey: 'AAAA' });
        return Promise.reject(new Error('backend down'));
      });

      // L'erreur remonte à l'appelant (le toggle Settings peut la traiter)...
      await expect(subscribeToPush()).rejects.toThrow('backend down');
      // ...et le navigateur n'est PAS resté abonné dans le dos du backend :
      // sinon getPushSubscriptionStatus() renverrait 'subscribed' et le toggle
      // afficherait ON sans qu'aucun push ne puisse arriver.
      expect(unsubscribe).toHaveBeenCalledTimes(1);
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

  describe('dropDevicePushSubscription', () => {
    it('désabonne le navigateur sans aucun appel serveur', async () => {
      const subscription = {
        endpoint: 'https://push.example/abc',
        unsubscribe: vi.fn().mockResolvedValue(true),
      };
      const getSubscription = vi.fn().mockResolvedValue(subscription);
      const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
      const register = vi.fn();
      defineServiceWorker({ getRegistration, register });
      definePushManagerSupport(true);

      await dropDevicePushSubscription();

      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
      // URL cliente confrontée aux scopes : retrouve la registration parce que
      // `register(SW_PATH)` est posé sans `scope` (donc `/`). Verrouillé pour
      // qu'un futur `scope` sur `register` ne fasse pas no-oper le helper.
      expect(getRegistration).toHaveBeenCalledWith('/sw-push.js');
      // Pas de token à ce stade : un DELETE partirait en 401. Le helper ne
      // doit même pas essayer.
      expect(mockedApi).not.toHaveBeenCalled();
      // Et il ne doit pas non plus enregistrer un service worker en passant :
      // on lâche un abonnement existant, on n'en prépare pas un.
      expect(register).not.toHaveBeenCalled();
    });

    it('no-op quand aucun service worker push n’est enregistré', async () => {
      const getRegistration = vi.fn().mockResolvedValue(undefined);
      defineServiceWorker({ getRegistration, register: vi.fn() });
      definePushManagerSupport(true);

      await expect(dropDevicePushSubscription()).resolves.toBeUndefined();
      expect(mockedApi).not.toHaveBeenCalled();
    });

    it('no-op quand le service worker n’a pas d’abonnement', async () => {
      const getSubscription = vi.fn().mockResolvedValue(null);
      const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
      defineServiceWorker({ getRegistration, register: vi.fn() });
      definePushManagerSupport(true);

      await expect(dropDevicePushSubscription()).resolves.toBeUndefined();
      expect(mockedApi).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePushSubscription', () => {
    it('souscription navigateur présente : POST /push/subscribe avec l’endpoint/keys existants', async () => {
      const getSubscription = vi.fn().mockResolvedValue({
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      });
      const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
      const register = vi.fn();
      defineServiceWorker({ getRegistration, register });
      definePushManagerSupport(true);
      mockedApi.mockResolvedValue({ ok: true });

      await reconcilePushSubscription();

      expect(getRegistration).toHaveBeenCalledWith('/sw-push.js');
      expect(mockedApi).toHaveBeenCalledTimes(1);
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/push/subscribe',
          body: {
            endpoint: 'https://push.example/abc',
            keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
            previewEnabled: true,
          },
        }),
      );
      // Pas d'installation de service worker en passant : on vérifie un
      // abonnement existant, on n'en prépare pas un (même logique que
      // `dropDevicePushSubscription`).
      expect(register).not.toHaveBeenCalled();
    });

    it('préférence Aperçu coupée sur cet appareil : previewEnabled: false dans le corps', async () => {
      // Miroir local coupé AVANT toute réconciliation (cf. `readPushPreview`) :
      // le corps envoyé doit refléter le choix de CET appareil, pas le défaut.
      window.localStorage.setItem('nx:pushPreview', 'off');
      const getSubscription = vi.fn().mockResolvedValue({
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      });
      const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
      defineServiceWorker({ getRegistration, register: vi.fn() });
      definePushManagerSupport(true);
      mockedApi.mockResolvedValue({ ok: true });

      await reconcilePushSubscription();

      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ previewEnabled: false }),
        }),
      );
    });

    it('aucune souscription navigateur : aucun appel serveur', async () => {
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
      defineServiceWorker({ getRegistration, register: vi.fn() });
      definePushManagerSupport(true);

      await reconcilePushSubscription();

      expect(mockedApi).not.toHaveBeenCalled();
    });

    it('aucun service worker enregistré : aucun appel serveur', async () => {
      const getRegistration = vi.fn().mockResolvedValue(undefined);
      defineServiceWorker({ getRegistration, register: vi.fn() });
      definePushManagerSupport(true);

      await reconcilePushSubscription();

      expect(mockedApi).not.toHaveBeenCalled();
    });

    it('navigateur non supporté : no-op silencieux', async () => {
      defineServiceWorker(undefined);
      definePushManagerSupport(false);

      await expect(reconcilePushSubscription()).resolves.toBeUndefined();
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
      await expect(dropDevicePushSubscription()).resolves.toBeUndefined();
      expect(mockedApi).not.toHaveBeenCalled();
    });
  });

  describe('setPushPreview', () => {
    it('test_setPushPreview_patches_existing_subscription', async () => {
      const getSubscription = vi.fn().mockResolvedValue({ endpoint: 'https://push.example/abc' });
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      mockedApi.mockResolvedValue({ ok: true });

      await setPushPreview(false);

      expect(register).toHaveBeenCalledWith('/sw-push.js');
      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PATCH',
          path: '/push/subscribe',
          body: { endpoint: 'https://push.example/abc', previewEnabled: false },
        }),
      );
    });

    it('test_setPushPreview_noop_when_no_subscription', async () => {
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      const registration = { pushManager: { getSubscription } };
      const register = vi.fn().mockResolvedValue(registration);
      defineServiceWorker({ register });
      definePushManagerSupport(true);

      await setPushPreview(true);

      expect(mockedApi).not.toHaveBeenCalled();
    });

    it('test_setPushPreview_noop_when_unsupported', async () => {
      defineServiceWorker(undefined);
      definePushManagerSupport(false);

      await expect(setPushPreview(true)).resolves.toBeUndefined();

      expect(mockedApi).not.toHaveBeenCalled();
    });

    it('test_setPushPreview_persists_choice_made_before_any_subscription', async () => {
      // Aucun abonnement sur cet appareil : rien à patcher côté serveur, mais
      // le choix ne doit PAS être perdu — sinon le prochain abonnement
      // repartirait au défaut `true` et le push s'afficherait en clair.
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      defineServiceWorker({
        register: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }),
      });
      definePushManagerSupport(true);

      await setPushPreview(false);

      expect(mockedApi).not.toHaveBeenCalled();
      expect(readPushPreview()).toBe(false);
    });

    it('test_setPushPreview_does_not_persist_when_patch_fails', async () => {
      const getSubscription = vi.fn().mockResolvedValue({ endpoint: 'https://push.example/abc' });
      defineServiceWorker({
        register: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }),
      });
      definePushManagerSupport(true);
      mockedApi.mockRejectedValue(new Error('backend down'));

      await expect(setPushPreview(false)).rejects.toThrow('backend down');

      // Le serveur n'a pas bougé : le miroir local non plus, sinon le toggle
      // afficherait "masqué" alors que le push partira en clair.
      expect(readPushPreview()).toBe(true);
    });
  });

  describe('readPushPreview / subscribeToPush', () => {
    it('test_subscribeToPush_sends_preference_set_before_subscribing', async () => {
      // 1. L'utilisateur coupe l'aperçu AVANT d'avoir jamais activé le push.
      const getSubscription = vi.fn().mockResolvedValue(undefined);
      defineServiceWorker({
        register: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }),
      });
      definePushManagerSupport(true);
      await setPushPreview(false);

      // 2. Il active le push : la souscription créée doit naître avec
      // previewEnabled=false, pas au défaut serveur `true`.
      const subscription = {
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      };
      const subscribe = vi.fn().mockResolvedValue(subscription);
      defineServiceWorker({
        register: vi.fn().mockResolvedValue({ pushManager: { subscribe, getSubscription } }),
      });
      mockedApi.mockImplementation((opts: any) => {
        if (opts.path === '/push/vapid-public-key') return Promise.resolve({ publicKey: 'AAAA' });
        return Promise.resolve({ ok: true });
      });

      await subscribeToPush();

      expect(mockedApi).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/push/subscribe',
          body: expect.objectContaining({ previewEnabled: false }),
        }),
      );
    });

    it('test_readPushPreview_defaults_to_true', () => {
      expect(readPushPreview()).toBe(true);
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
