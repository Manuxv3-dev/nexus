/**
 * Helpers Tauri 2 — détection runtime + commandes Nexus custom (cf. ADR-026).
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
 * Convention : `provider:{providerType}:{sessionId}`. Le label est utilisé
 * comme nom de dossier pour le `data_directory` (cookies isolés) — on ne
 * doit donc jamais y mettre de path traversal. Le backend Rust valide
 * en plus le charset (cf. `sanitize_label`).
 */
export function providerWebviewLabel(
  providerType: 'whatsapp' | 'messenger',
  sessionId: string,
): string {
  return `provider:${providerType}:${sessionId}`;
}

/**
 * URL canonique de la page web officielle de chaque provider.
 */
export const PROVIDER_WEB_URL: Record<'whatsapp' | 'messenger', string> = {
  whatsapp: 'https://web.whatsapp.com/',
  messenger: 'https://www.messenger.com/',
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
