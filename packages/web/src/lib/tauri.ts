/**
 * Helpers Tauri 2 — détection runtime + commandes nexus custom (cf. ADR-026).
 *
 * En mode navigateur web pur (`pnpm --filter @nexus/web dev` sans Tauri) :
 *   - `isTauri()` renvoie `false`
 *   - Les autres helpers no-op et ne font aucun import lourd
 *
 * En mode Tauri (`pnpm --filter @nexus/desktop tauri:dev` qui spawn Vite +
 * une window native) :
 *   - `isTauri()` renvoie `true` (via `window.__TAURI_INTERNALS__`)
 *   - Les helpers délèguent à `@tauri-apps/api/core::invoke` qui appelle les
 *     commandes Rust déclarées dans `packages/desktop/src-tauri/src/webview.rs`
 *
 * Ce module reste safe à importer côté web pur — `@tauri-apps/api` ne
 * touche pas au DOM avant qu'on appelle `invoke()`.
 */
import { invoke } from '@tauri-apps/api/core';

export interface ProviderWebviewBounds {
  /** Position X (logique, pixels CSS) depuis le coin haut-gauche de la window. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Détecte si on tourne dans le runtime Tauri.
 *
 * Tauri 2 expose `__TAURI_INTERNALS__` (Tauri 1 utilisait `__TAURI__`).
 * On vérifie les deux par sûreté pour le futur.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/**
 * Construit le label canonique d'une webview encapsulée.
 *
 * Convention : `provider:{providerType}:{userId}`. Le label est utilisé
 * comme nom de dossier pour le `data_directory` (cookies isolés) — on ne
 * doit donc jamais y mettre de path traversal. Le backend Rust valide
 * en plus le charset (cf. `sanitize_label`).
 *
 * MAN-238 : dérivé de `userId`, pas de `session.id`. `sessions.id` est un
 * `uuid().defaultRandom()` et `DELETE /me/messaging/sessions/:sessionId` est
 * un hard delete — une reconnexion mint un nouveau `session.id`. Le backend
 * garantit déjà l'unicité `(provider_type, external_id)` avec
 * `externalId = 'webview:${userId}'` (cf.
 * `packages/backend/src/routes/messaging/index.ts`), donc `userId` est
 * l'identité stable à travers un cycle delete/create. Un `userId` UUID passe
 * `sanitize_label` sans transformation (charset `[a-z0-9._:-]`).
 */
export function providerWebviewLabel(providerType: WebviewProvider, userId: string): string {
  return `provider:${providerType}:${userId}`;
}

/** Type unifié des providers webview-encapsulés (cf. ADR-027). */
export type WebviewProvider =
  | 'discord'
  | 'whatsapp'
  | 'messenger'
  | 'telegram'
  | 'instagram'
  | 'slack'
  | 'teams'
  | 'linkedin'
  | 'twitter'
  | 'reddit'
  | 'tiktok'
  | 'snapchat';

/**
 * URL canonique de la page web officielle de chaque provider — la webview
 * Tauri pointe ici. Aligné sur ADR-027 (12 providers en webview).
 */
export const PROVIDER_WEB_URL: Record<WebviewProvider, string> = {
  discord: 'https://discord.com/channels/@me',
  whatsapp: 'https://web.whatsapp.com/',
  messenger: 'https://www.messenger.com/',
  telegram: 'https://web.telegram.org/',
  instagram: 'https://www.instagram.com/direct/inbox/',
  slack: 'https://app.slack.com/',
  teams: 'https://teams.microsoft.com/',
  linkedin: 'https://www.linkedin.com/messaging/',
  twitter: 'https://x.com/messages',
  reddit: 'https://chat.reddit.com/',
  tiktok: 'https://www.tiktok.com/messages',
  snapchat: 'https://web.snapchat.com/',
};

/**
 * Crée (ou réutilise) une webview enfant attachée à la window principale.
 *
 * Idempotent côté Rust : si une webview avec ce label existe déjà, le
 * backend resize à la place de doubler.
 */
export async function createProviderWebview(input: {
  label: string;
  url: string;
  bounds: ProviderWebviewBounds;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke('create_provider_webview', input);
}

/**
 * Met à jour les bounds d'une webview existante.
 *
 * À appeler quand la zone main de l'AppShell change de taille (resize de la
 * fenêtre, sidebar collapsée, etc.). Côté React, brancher un
 * `ResizeObserver` sur le container.
 */
export async function setProviderWebviewBounds(input: {
  label: string;
  bounds: ProviderWebviewBounds;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke('set_provider_webview_bounds', input);
}

/**
 * Affiche / cache une webview sans la détruire (préserve cookies + DOM).
 *
 * Quand visible=true, `bounds` est requis pour repositionner la webview
 * (côté Rust, le hide la déplace hors-écran).
 */
export async function setProviderWebviewVisible(input: {
  label: string;
  visible: boolean;
  bounds?: ProviderWebviewBounds;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke('set_provider_webview_visible', input);
}

/**
 * Détruit une webview (le data_directory est conservé sur disque pour
 * réutiliser la session au prochain create — comportement intentionnel).
 */
export async function destroyProviderWebview(label: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('destroy_provider_webview', { label });
}

/**
 * Vérifie, pour un lot de labels, si leur `data_directory` existe encore sur
 * disque (MAN-239). Lecture seule — pilote côté frontend l'affichage de
 * l'action « supprimer les données locales » par provider : inutile de la
 * proposer tant qu'aucune partition n'a été créée (pas de connexion
 * effectuée, ou déjà purgée précédemment).
 *
 * En mode web pur, renvoie `{}` (aucun label connu) plutôt que de lever —
 * même convention que les autres helpers de ce module.
 */
export async function checkProviderWebviewDataStatus(
  labels: string[],
): Promise<Record<string, boolean>> {
  if (!isTauri()) return {};
  return invoke('provider_webview_data_status', { labels });
}

/**
 * Supprime réellement le `data_directory` d'un provider (cookies + cache) —
 * contrairement à `destroyProviderWebview` ci-dessus qui conserve
 * volontairement la partition. C'est la commande à appeler pour un
 * nettoyage explicite (équivalent "logout" / RGPD, MAN-239).
 *
 * Idempotent côté Rust : un dossier déjà absent est un succès, pas une
 * erreur. Si la webview est encore montée, elle est fermée d'abord.
 */
export async function deleteProviderWebviewData(label: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_provider_webview_data', { label });
}

/** Bilan d'un balayage (`SweepReport` côté Rust). Purement informatif — le
 * balayage est silencieux, ces compteurs ne servent qu'au log/diagnostic. */
export interface WebviewSweepReport {
  /** Partitions orphelines effectivement supprimées. */
  removed: number;
  /** Partitions conservées (dans la keep-list, ou backing une webview montée). */
  kept: number;
  /** Entrées ignorées sur erreur (verrou OS, permission refusée, nom non-UTF8). */
  failed: number;
}

/**
 * Balaie `app_data_dir()/webviews/` et supprime toute partition qui ne
 * correspond ni à un label de `keepLabels`, ni à une webview actuellement
 * montée (garde-fou côté Rust). Filet de rattrapage global des partitions
 * orphelines — providers retirés, ancien `userId` après changement de compte,
 * anciens labels `session_id`-based d'avant MAN-238 (MAN-239 phase 3).
 *
 * `keepLabels` est la liste faisant autorité : elle vient des sessions
 * renvoyées par l'API, pas du filesystem. La passer incomplète supprime de
 * vraies partitions — cf. `useWebviewPartitionSweep`, qui n'appelle ce
 * wrapper qu'une fois les sessions réellement résolues.
 *
 * Ne lève pas côté Rust pour un dossier verrouillé/illisible (compté dans
 * `failed`) : un balayage de démarrage ne doit jamais empêcher l'app de
 * démarrer.
 */
export async function sweepOrphanedWebviewPartitions(
  keepLabels: string[],
): Promise<WebviewSweepReport> {
  if (!isTauri()) return { removed: 0, kept: 0, failed: 0 };
  return invoke('sweep_orphaned_webview_partitions', { keepLabels });
}
