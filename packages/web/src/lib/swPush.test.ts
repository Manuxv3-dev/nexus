/**
 * Tests du service worker push (`public/sw-push.js`, MAN-143 Phase 2 Task 3).
 *
 * Le SW est un fichier STATIQUE servi sans bundler : il ne peut pas importer
 * `pushDeepLink.ts` et recopie donc sa construction d'URL en JS vanilla
 * (`buildDeepLinkUrlInline`). Le commentaire du fichier juge « le risque de
 * divergence faible » — ce test le rend nul : on charge le vrai fichier SW
 * dans un environnement simulé et on compare sa sortie à celle du vrai
 * `buildDeepLinkUrl` pour les mêmes entrées. Toute divergence entre les deux
 * copies casse la CI au lieu de casser silencieusement le deep-link « app
 * fermée » (le seul chemin qui passe par `clients.openWindow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// `?raw` (Vite) : on charge le fichier RÉELLEMENT servi aux navigateurs, pas
// une copie de son contenu.
import swSource from '../../public/sw-push.js?raw';

import { buildDeepLinkUrl, type PushDeepLinkData } from './pushDeepLink';

interface FakeExtendableEvent {
  waitUntil: (p: Promise<unknown>) => void;
}

interface FakePushEvent extends FakeExtendableEvent {
  data: { json: () => unknown } | null;
}

interface FakeNotificationClickEvent extends FakeExtendableEvent {
  notification: { close: () => void; data: unknown };
}

interface FakePushSubscriptionChangeEvent extends FakeExtendableEvent {
  oldSubscription: { options: { applicationServerKey: unknown } } | null | undefined;
}

type Listener = (event: never) => void;

interface FakeWindowClient {
  focus: () => Promise<void>;
  postMessage: (message: unknown) => void;
}

/**
 * Charge `public/sw-push.js` dans un scope simulé. Le fichier n'utilise que
 * `self` (addEventListener + registration) et le global `clients` : les
 * passer en paramètres d'une factory suffit à l'exécuter hors navigateur,
 * sans stub de module ni copie du code sous test.
 *
 * `subscribe` est surchageable (2e argument) pour les tests
 * `pushsubscriptionchange` qui veulent observer un rejet du navigateur ;
 * `fetch`/`console.warn`, eux, restent les vrais globaux (le fichier ne les
 * reçoit pas en paramètre) — les tests qui en ont besoin les stubbent/spient
 * directement (`vi.stubGlobal`, `vi.spyOn`), comme `api.test.ts`.
 */
function loadServiceWorker(
  windowClients: FakeWindowClient[] = [],
  options: { subscribe?: ReturnType<typeof vi.fn> } = {},
) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue(windowClients);
  const subscribe = options.subscribe ?? vi.fn().mockResolvedValue(undefined);

  const selfStub = {
    addEventListener: (type: string, handler: Listener) => listeners.set(type, handler),
    registration: { showNotification, pushManager: { subscribe } },
  };
  const clientsStub = { matchAll, openWindow };

  // Le SW est un fichier statique non bundlé : l'exécuter tel quel dans un
  // scope contrôlé est la seule façon de tester le code RÉELLEMENT servi aux
  // navigateurs (source fixe du repo, aucune entrée externe).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('self', 'clients', swSource) as (s: unknown, c: unknown) => void;
  factory(selfStub, clientsStub);

  return { listeners, showNotification, openWindow, matchAll, subscribe };
}

/** Déclenche un listener du SW et attend la promesse passée à `waitUntil`. */
async function fire<E extends FakeExtendableEvent>(
  listener: Listener | undefined,
  event: Omit<E, 'waitUntil'>,
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const full = { ...event, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  (listener as ((e: unknown) => void) | undefined)?.(full);
  await Promise.all(pending);
}

describe('sw-push.js — push', () => {
  it('affiche la notification avec le `data` de deep-link intact', async () => {
    const { listeners, showNotification } = loadServiceWorker();
    const data = { groupId: 'g1', pane: 'event', sourceId: 'e1' };

    await fire<FakePushEvent>(listeners.get('push'), {
      data: { json: () => ({ title: 'Nexus', body: 'Coucou', data }) },
    });

    expect(showNotification).toHaveBeenCalledWith('Nexus', { body: 'Coucou', data });
  });

  it('ignore un push sans data', async () => {
    const { listeners, showNotification } = loadServiceWorker();

    await fire<FakePushEvent>(listeners.get('push'), { data: null });

    expect(showNotification).not.toHaveBeenCalled();
  });
});

describe('sw-push.js — notificationclick', () => {
  const cases: PushDeepLinkData[] = [
    { groupId: 'g1', pane: 'event', sourceId: 'e1' },
    { groupId: 'g1', pane: 'expense', sourceId: null },
    { groupId: 'g1', pane: 'todo', sourceId: 'todo-1' },
    { groupId: null, pane: 'event', sourceId: 'e1' },
    { groupId: 'g1', pane: 'home', sourceId: null },
  ];

  it.each(cases)(
    'aucune fenêtre ouverte : openWindow reçoit exactement buildDeepLinkUrl(%j)',
    async (data) => {
      const { listeners, openWindow } = loadServiceWorker([]);

      await fire<FakeNotificationClickEvent>(listeners.get('notificationclick'), {
        notification: { close: vi.fn(), data },
      });

      expect(openWindow).toHaveBeenCalledWith(buildDeepLinkUrl(data));
    },
  );

  it('aucune fenêtre ouverte et data absent : retombe sur /app', async () => {
    const { listeners, openWindow } = loadServiceWorker([]);

    await fire<FakeNotificationClickEvent>(listeners.get('notificationclick'), {
      notification: { close: vi.fn(), data: undefined },
    });

    expect(openWindow).toHaveBeenCalledWith('/app');
  });

  it('fenêtre déjà ouverte : refocus + postMessage push-navigate, pas de nouvelle fenêtre', async () => {
    const client: FakeWindowClient = {
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    const { listeners, openWindow } = loadServiceWorker([client]);
    const data = { groupId: 'g1', pane: 'event', sourceId: 'e1' };

    await fire<FakeNotificationClickEvent>(listeners.get('notificationclick'), {
      notification: { close: vi.fn(), data },
    });

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'push-navigate', target: data });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('ferme la notification cliquée', async () => {
    const { listeners } = loadServiceWorker([]);
    const close = vi.fn();

    await fire<FakeNotificationClickEvent>(listeners.get('notificationclick'), {
      notification: { close, data: { groupId: 'g1', pane: 'event', sourceId: 'e1' } },
    });

    expect(close).toHaveBeenCalledTimes(1);
  });
});

/**
 * `pushsubscriptionchange` (ticket e9ad5861, complément de #111 qui ne
 * couvrait que le nettoyage côté SERVEUR) : le navigateur a révoqué ou fait
 * roter l'abonnement de son propre chef, hors de toute action Nexus.
 */
describe('sw-push.js — pushsubscriptionchange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ancien abonnement avec clé : re-souscrit avec la clé de L'ANCIEN abonnement", async () => {
    const applicationServerKey = new Uint8Array([1, 2, 3]);
    const { listeners, subscribe } = loadServiceWorker();

    await fire<FakePushSubscriptionChangeEvent>(listeners.get('pushsubscriptionchange'), {
      oldSubscription: { options: { applicationServerKey } },
    });

    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey });
  });

  it('sans oldSubscription : va chercher la clé VAPID publique au même endpoint que subscribeToPush et re-souscrit', async () => {
    // Clé arbitraire, base64 URL-safe (contient `-`/`_`, décodable par atob
    // une fois retranscrite en base64 standard) — même format que la vraie
    // clé publique VAPID servie par le backend.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: 'AAECAw' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { listeners, subscribe } = loadServiceWorker();

    await fire<FakePushSubscriptionChangeEvent>(listeners.get('pushsubscriptionchange'), {
      oldSubscription: null,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/push/vapid-public-key');
    expect(subscribe).toHaveBeenCalledTimes(1);
    const call = subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(call.userVisibleOnly).toBe(true);
    expect(Array.from(call.applicationServerKey)).toEqual([0, 1, 2, 3]);
  });

  it('sans oldSubscription et fetch en échec : aucune re-souscription, warn loggé', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { listeners, subscribe } = loadServiceWorker();

    await fire<FakePushSubscriptionChangeEvent>(listeners.get('pushsubscriptionchange'), {
      oldSubscription: undefined,
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('sans oldSubscription et fetch non-OK (ex. 404) : aucune re-souscription, warn loggé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { listeners, subscribe } = loadServiceWorker();

    await fire<FakePushSubscriptionChangeEvent>(listeners.get('pushsubscriptionchange'), {
      oldSubscription: undefined,
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('subscribe() rejeté par le navigateur : warn loggé, ne relance pas (waitUntil se résout)', async () => {
    const subscribe = vi.fn().mockRejectedValue(new Error('permission denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { listeners } = loadServiceWorker([], { subscribe });
    const applicationServerKey = new Uint8Array([9]);

    await expect(
      fire<FakePushSubscriptionChangeEvent>(listeners.get('pushsubscriptionchange'), {
        oldSubscription: { options: { applicationServerKey } },
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
  });
});
