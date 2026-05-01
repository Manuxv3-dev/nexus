/**
 * @nexus/platform — Interfaces des capacités natives
 *
 * Conformément à l'ADR-014, ce package expose uniquement des interfaces
 * TypeScript (pas de code). Trois implémentations consommées au runtime :
 *  - @nexus/platform-web    (Web APIs)
 *  - @nexus/platform-tauri  (Tauri APIs, J4d)
 *  - @nexus/platform-rn     (Expo APIs, V2)
 */

export interface NotificationProvider {
  /** Demande la permission pour afficher des notifications natives. */
  requestPermission(): Promise<'granted' | 'denied' | 'default'>;
  /** Affiche une notification. Lève si la permission n'est pas accordée. */
  show(opts: NotificationOptions): Promise<void>;
  /** Renvoie l'état courant de la permission, sans la demander. */
  getPermission(): Promise<'granted' | 'denied' | 'default'>;
}

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  /** ID stable pour grouper les notifs (ex. groupId). */
  tag?: string;
  /** URL à ouvrir au clic. */
  href?: string;
}

export interface SecureStorageProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface DeepLinkProvider {
  /** Renvoie l'URL initiale (cold start) ou null. */
  getInitialUrl(): Promise<string | null>;
  /** S'abonne aux deep links incoming. Renvoie une fonction de désabonnement. */
  subscribe(handler: (url: string) => void): () => void;
}

export interface ClipboardProvider {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface PlatformCapabilities {
  notifications: NotificationProvider;
  secureStorage: SecureStorageProvider;
  deepLinks: DeepLinkProvider;
  clipboard: ClipboardProvider;
  /** Identifiant du host : 'web', 'tauri', 'rn'. */
  host: 'web' | 'tauri' | 'rn';
}
