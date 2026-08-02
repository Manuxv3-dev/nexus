/**
 * @nexus/platform-web — Implémentation des capacités natives via Web APIs.
 *
 * Concrètement :
 *  - Notifications  : Web Notifications API (préparé pour J4c Web Push)
 *  - SecureStorage  : localStorage (chiffré côté serveur via cookie httpOnly,
 *                     ce store ne doit jamais contenir de credentials, cf. ADR-015)
 *  - DeepLinks      : URL hash + popstate (le navigateur gère nativement)
 *  - Clipboard      : navigator.clipboard
 */
import type {
  ClipboardProvider,
  DeepLinkProvider,
  NotificationOptions,
  NotificationProvider,
  PlatformCapabilities,
  SecureStorageProvider,
} from '@nexus/platform';

const webNotifications: NotificationProvider = {
  // Le contrat `NotificationProvider` impose une fonction async (les autres
  // hosts, ex. Tauri, ont un vrai await) ; ici c'est une lecture synchrone.
  // eslint-disable-next-line @typescript-eslint/require-await
  async getPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission;
  },
  async requestPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    const result = await Notification.requestPermission();
    return result;
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async show(opts: NotificationOptions) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    // exactOptionalPropertyTypes : on construit l'objet sans les `undefined`
    // explicites pour éviter les erreurs sur l'init NotificationOptions du DOM.
    const init: { body: string; icon?: string; tag?: string } = { body: opts.body };
    if (opts.icon !== undefined) init.icon = opts.icon;
    if (opts.tag !== undefined) init.tag = opts.tag;
    const n = new Notification(opts.title, init);
    if (opts.href) {
      const href = opts.href;
      n.onclick = () => {
        window.focus();
        window.location.href = href;
      };
    }
  },
};

const NAMESPACE = 'nexus.';

// Le contrat `SecureStorageProvider` impose des fonctions async (les autres
// hosts, ex. Tauri, ont un vrai await) ; ici localStorage est synchrone.
const webSecureStorage: SecureStorageProvider = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async get(key: string) {
    return localStorage.getItem(NAMESPACE + key);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async set(key: string, value: string) {
    localStorage.setItem(NAMESPACE + key, value);
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async remove(key: string) {
    localStorage.removeItem(NAMESPACE + key);
  },
};

const webDeepLinks: DeepLinkProvider = {
  // Contrat `DeepLinkProvider` async (cf. plus haut) ; lecture synchrone ici.
  // eslint-disable-next-line @typescript-eslint/require-await
  async getInitialUrl() {
    return window.location.href;
  },
  subscribe(handler: (url: string) => void) {
    const onPop = () => handler(window.location.href);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  },
};

const webClipboard: ClipboardProvider = {
  async writeText(text: string) {
    await navigator.clipboard.writeText(text);
  },
  async readText() {
    return navigator.clipboard.readText();
  },
};

export const WebPlatform: PlatformCapabilities = {
  host: 'web',
  notifications: webNotifications,
  secureStorage: webSecureStorage,
  deepLinks: webDeepLinks,
  clipboard: webClipboard,
};
