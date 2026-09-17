/**
 * Client HTTP Nexus.
 *
 * Conformément à ADR-015, le mode web s'appuie sur :
 *  - Cookie httpOnly `nexus_refresh` (géré par le navigateur)
 *  - Cookie `nexus_csrf` lisible par le JS (qu'on relit pour les POST/PATCH/DELETE)
 *  - Header `X-Nexus-Client: web` sur toutes les requêtes auth
 *  - Access token JWT court (15 min) gardé en mémoire (zustand) — jamais en
 *    localStorage car vulnérable à XSS
 *
 * En cas de 401 sur un endpoint protégé, on tente un refresh transparent puis
 * on rejoue la requête. Si le refresh échoue → redirige vers /login.
 */
import { z, type ZodType } from 'zod';

import { clearSecureToken, isTauri, writeSecureToken } from './tauri';

/**
 * Base URL des appels API.
 *
 * - Web build (Caddy `app.nexusapp.chat`) : `/api/v1` (relatif, Traefik proxy).
 * - Tauri desktop : `https://api.nexusapp.chat/api/v1` (absolu, défini via
 *   `VITE_API_BASE` au build time).
 *
 * Cf. ADR-031 (release desktop Tauri).
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '/api/v1';

let accessTokenInMemory: string | null = null;
/**
 * Refresh token du mode natif (desktop, cf. ADR-038).
 *
 * En mode web il reste `null` : le token y vit dans le cookie httpOnly
 * `nexus_refresh`, que le JS ne doit pas pouvoir lire. En mode natif il n'y a
 * pas de cookie exploitable — front et API sont cross-site — donc le token est
 * porté par l'application.
 *
 * En mémoire uniquement à ce stade : la persistance au magasin de secrets de
 * l'OS est la phase suivante. `localStorage` est exclu par ADR-038, et pour ce
 * token plus encore que pour l'access token (30 jours contre 15 minutes).
 */
let refreshTokenInMemory: string | null = null;
/**
 * Hook « la session vient de tomber » : appelé quand un 401 n'a pas pu être
 * rattrapé par un refresh. Reçoit la cause de l'échec du refresh (l'`ApiError`
 * renvoyée par `/auth/refresh`, ou l'erreur réseau brute) pour que le
 * receveur puisse distinguer un refus du serveur — session morte — d'une
 * coupure transitoire qui laisse le cookie de refresh valide.
 */
type AuthExpiredHandler = (cause: unknown) => void;
let onAuthExpired: AuthExpiredHandler | null = null;

export function setAccessToken(token: string | null) {
  accessTokenInMemory = token;
}
export function getAccessToken(): string | null {
  return accessTokenInMemory;
}
/**
 * Pose le refresh token du mode natif — **et le persiste** au magasin de
 * secrets de l'OS (cf. ADR-038).
 *
 * La persistance est faite ici plutôt qu'à chaque point d'appel, et c'est
 * délibéré : il y en a sept (login, register, hydratation au démarrage,
 * rotation au refresh transparent, rotation dans `init`, logout, suppression
 * de compte), et en oublier un seul — celui de la rotation — laisserait
 * l'application rejouer un token révoqué au lancement suivant, ce que le
 * backend lit comme un vol et qui **révoque toutes les sessions**. Un setter
 * qui ne peut pas être contourné vaut mieux qu'une discipline d'appel.
 *
 * L'écriture est volontairement non attendue : elle ne peut pas échouer de
 * façon visible (cf. `writeSecureToken`), et rien dans le flux d'auth ne
 * dépend de son issue.
 *
 * @param token Le token, ou `null` pour effacer (logout).
 * @param persist `false` pour ne pas réécrire ce qu'on vient justement de lire
 * au magasin — hydratation au démarrage.
 */
export function setRefreshToken(token: string | null, persist = true) {
  refreshTokenInMemory = token;
  if (!persist) return;
  if (token) void writeSecureToken(token);
  else void clearSecureToken();
}
export function getRefreshToken(): string | null {
  return refreshTokenInMemory;
}
export function setOnAuthExpired(handler: AuthExpiredHandler | null) {
  onAuthExpired = handler;
}

/**
 * « Le serveur a refusé la session » — la seule issue d'un refresh qui doit
 * coûter la session, et avec elle le refresh token persisté (ADR-038).
 *
 * 401 est le seul code par lequel `/auth/refresh` dit « ce token est mort »
 * (expiré, révoqué, réutilisé, cookie absent — cf. `AUTH_TOKEN_*` et
 * `AUTH_REFRESH_REUSED` dans `backend/src/core/errors.ts`). Tout le reste —
 * coupure réseau, 5xx pendant un déploiement — ne dit rien de la session : le
 * token est toujours valide côté serveur, et l'effacer (magasin de l'OS
 * compris, en natif) transformait un portable qui se réveille avant son
 * Wi-Fi en déconnexion définitive (cf. 17d116dc). Ces échecs-là sont
 * transitoires : on garde le token et on retentera au prochain 401.
 *
 * Reste le 403 CSRF (`nexus_csrf` disparu sans `nexus_refresh`, improbable
 * hors suppression manuelle vu leur `maxAge` commun) : session vivante mais
 * re-login obligatoire — laissé hors du prédicat, 401 est le seul signal
 * univoque. Partagé par `tryRefresh`, `auth.init()` et le hook 401, pour ne
 * pas encoder trois invariants différents du même événement.
 */
export function isSessionRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

function readCsrfFromCookie(): string | null {
  const m = /(?:^|; )nexus_csrf=([^;]+)/.exec(document.cookie);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

interface ApiOptions<TBody, TReply> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  body?: TBody;
  /** Schéma Zod pour valider la réponse. */
  reply?: ZodType<TReply>;
  /** Désactive le retry automatique sur 401. */
  noRetry?: boolean;
  /** Désactive l'envoi du token Authorization (utile pour les appels publics). */
  unauthenticated?: boolean;
}

/**
 * Normalise le corps d'une réponse d'erreur en `ApiErrorPayload`.
 *
 * Le backend enveloppe TOUTES ses erreurs dans
 * `{ error: { code, message, details, requestId } }`
 * (`backend/src/core/error-handler.ts#buildResponse`). Sans ce déballage,
 * `ApiError.code` valait `undefined` et `ApiError.message` la chaîne vide :
 * tous les branchements `err.code === '...'` des écrans (LoginScreen,
 * RegisterScreen, ResetPasswordScreen, SettingsScreen) étaient morts
 * silencieusement, et les écrans qui affichent `err.message` rendaient un
 * message vide. Corrigé lors de la revue de MAN-173.
 *
 * Une charge « à plat » (`{ code, message }`) reste acceptée par tolérance :
 * certaines erreurs 4xx peuvent être émises par un proxy en amont de
 * l'error-handler Fastify.
 */
function toErrorPayload(data: unknown, status: number): ApiErrorPayload {
  const fallback: ApiErrorPayload = {
    code: 'UNKNOWN_ERROR',
    message: `HTTP ${status}`,
  };
  if (typeof data !== 'object' || data === null) return fallback;

  const enveloped = (data as { error?: unknown }).error;
  const candidate = (
    typeof enveloped === 'object' && enveloped !== null ? enveloped : data
  ) as Partial<ApiErrorPayload>;

  if (typeof candidate.code !== 'string') return fallback;
  return {
    code: candidate.code,
    message: typeof candidate.message === 'string' ? candidate.message : fallback.message,
    details: candidate.details,
  };
}

async function rawFetch<TReply>(opts: ApiOptions<unknown, TReply>): Promise<TReply> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    // Le backend n'a qu'un cas particulier : `web` le fait basculer en mode
    // cookie + CSRF (cf. `detectClientMode`). L'annoncer en dur sur desktop
    // forçait un mode dont le cookie ne peut pas revenir — c'était tout le
    // bug d'ADR-038. `native` est explicite plutôt qu'omis, pour que le mode
    // se lise dans les logs serveur.
    'X-Nexus-Client': isTauri() ? 'native' : 'web',
    Accept: 'application/json',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!opts.unauthenticated && accessTokenInMemory) {
    headers.Authorization = `Bearer ${accessTokenInMemory}`;
  }
  // CSRF requis pour les méthodes mutantes en mode web (cf. ADR-015).
  if (method !== 'GET') {
    const csrf = readCsrfFromCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_BASE}${opts.path}`, init);

  if (res.status === 204) return undefined as unknown as TReply;

  let data: unknown = null;
  if (res.headers.get('content-type')?.includes('application/json')) {
    data = await res.json();
  }

  if (!res.ok) {
    throw new ApiError(res.status, toErrorPayload(data, res.status));
  }

  if (opts.reply) {
    const parsed = opts.reply.safeParse(data);
    if (!parsed.success) {
      console.error('[api] reply schema mismatch', {
        path: opts.path,
        issues: parsed.error.issues,
      });
      throw new ApiError(500, {
        code: 'INVALID_RESPONSE',
        message: 'La réponse du serveur ne respecte pas le contrat attendu',
      });
    }
    return parsed.data;
  }
  return data as TReply;
}

export async function api<TReply>(opts: ApiOptions<unknown, TReply>): Promise<TReply> {
  try {
    return await rawFetch(opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !opts.noRetry && !opts.unauthenticated) {
      // Tentative de refresh silencieux.
      const refresh = await tryRefresh();
      if (refresh.ok) {
        return await rawFetch({ ...opts, noRetry: true });
      }
      // Seul un échec terminal fait tomber la session. Un échec transitoire
      // laisse la requête d'origine échouer (c'est à l'appelant de l'afficher)
      // et le prochain 401 retentera le refresh — l'app reste connectée.
      if (refresh.terminal) onAuthExpired?.(refresh.cause);
    }
    throw err;
  }
}

/**
 * Issue d'un refresh. `cause` porte l'erreur qui l'a fait échouer, pour que
 * `onAuthExpired` puisse la qualifier (cf. `AuthExpiredHandler`). `terminal`
 * dit si cet échec coûte la session : refus du serveur (cf.
 * `isSessionRejected`) ou rien à rejouer — par opposition à un échec
 * transitoire, qui laisse tout en place pour le prochain essai.
 */
type RefreshOutcome = { ok: true } | { ok: false; cause: unknown; terminal: boolean };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

const RefreshReplySchema = z.object({
  accessToken: z.string(),
  /** Présent en mode natif uniquement : le backend rote le token à chaque refresh. */
  refreshToken: z.string().optional(),
});

/** Nom du verrou Web Locks partagé par tous les onglets du même origin — cf. `withCrossTabRefreshLock`. */
const REFRESH_LOCK_NAME = 'nexus-refresh';
/** Clé localStorage du marqueur cross-onglet — cf. `readRefreshMarker`. */
const REFRESH_MARKER_KEY = 'nexus:refresh:last';

/**
 * Marqueur "un refresh vient d'aboutir quelque part" (mode web uniquement).
 *
 * Le cookie `nexus_refresh` est httpOnly (cf. `setAuthCookies` côté backend) :
 * le JS ne peut jamais le lire, donc il ne peut pas servir de signal "un
 * autre onglet a déjà roté le cookie" à `withCrossTabRefreshLock`. À la
 * place, chaque refresh web réussi écrit ici une valeur opaque (horodatage +
 * nonce ; seul son *changement* compte, jamais sa valeur) dans
 * `localStorage`, partagé par tous les onglets du même origin.
 *
 * Best-effort : un `localStorage` indisponible (navigation privée stricte,
 * quota dépassé) ne doit jamais faire échouer le refresh — juste renoncer à
 * la dédup cross-onglet pour cet appel, d'où les try/catch silencieux.
 */
function readRefreshMarker(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_MARKER_KEY);
  } catch {
    return null;
  }
}

/** Pendant en écriture de `readRefreshMarker`, appelé après un refresh web réussi. */
function writeRefreshMarker(): void {
  try {
    window.localStorage.setItem(
      REFRESH_MARKER_KEY,
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  } catch {
    // best-effort — cf. JSDoc de `readRefreshMarker`.
  }
}

/**
 * Sérialise `perform` (le refresh réseau) entre onglets du même origin, mode
 * web uniquement — jamais appelée en mode natif (une seule fenêtre, cf.
 * `tryRefresh`).
 *
 * Protocole : on lit le marqueur cross-onglet AVANT de demander le verrou
 * `navigator.locks`, puis on le relit UNE FOIS le verrou obtenu. S'il a
 * changé entre les deux lectures, un autre onglet a rafraîchi pendant
 * l'attente — le cookie `nexus_refresh` est déjà à jour, rejouer l'ancien
 * (T0) déclencherait `AUTH_REFRESH_REUSED` côté backend (cf. ADR-040, fenêtre
 * de grâce). On saute donc l'appel réseau et on considère la session valide :
 * l'access token en mémoire de CET onglet, lui, reste périmé — il sera
 * renouvelé au prochain 401, qui retentera un refresh sous verrou, cette
 * fois non contesté.
 *
 * Fallback : `navigator.locks` absent (vieux navigateur, contexte non
 * sécurisé) → comportement pré-existant, un refresh non-dédupliqué entre
 * onglets, sans erreur.
 */
function withCrossTabRefreshLock(perform: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
  if (typeof navigator === 'undefined' || !navigator.locks) return perform();
  const markerBeforeWait = readRefreshMarker();
  // `LockGrantedCallback<T>` (lib.dom) est déclaré `(lock) => T`, sans
  // aplatissement de `Promise<T>` — alors que la spec Web Locks, elle, attend
  // bien la promesse renvoyée par le callback avant de résoudre la sienne.
  // Sans le cast, TS infère `T = Promise<RefreshOutcome>` et typerait
  // `request()` en `Promise<Promise<RefreshOutcome>>`, qui ne reflète pas la
  // valeur réellement livrée à l'exécution.
  const result = navigator.locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, () => {
    if (readRefreshMarker() !== markerBeforeWait)
      return Promise.resolve<RefreshOutcome>({ ok: true });
    return perform();
  });
  return result as unknown as Promise<RefreshOutcome>;
}

/** Corps du refresh proprement dit — partagé par le mode web (sous verrou cross-onglet) et natif (direct). */
async function performRefreshRequest(native: boolean): Promise<RefreshOutcome> {
  try {
    const reply = await rawFetch({
      method: 'POST',
      path: '/auth/refresh',
      // Mode web : corps vide, le cookie porte le token. Mode natif : c'est
      // le corps qui le porte. Ne jamais fournir les deux — le backend
      // rejette la requête (`ambiguous_token_sources`).
      body: native ? { refreshToken: refreshTokenInMemory } : {},
      reply: RefreshReplySchema,
      noRetry: true,
      unauthenticated: true,
    });
    setAccessToken(reply.accessToken);
    // Rotation : le backend vient de révoquer l'ancien token. Ne pas garder
    // le nouveau ferait rejouer un token révoqué au refresh suivant, ce qui
    // est interprété comme un vol (`AUTH_REFRESH_REUSED`) et **révoque
    // toutes les sessions de l'utilisateur**.
    if (reply.refreshToken) setRefreshToken(reply.refreshToken);
    // Signale aux autres onglets que le cookie vient d'être roté (cf.
    // `withCrossTabRefreshLock`). Natif exclu : pas de cookie partagé, pas
    // d'autre fenêtre, et ADR-038 exclut `localStorage` pour ce token.
    if (!native) writeRefreshMarker();
    return { ok: true };
  } catch (cause) {
    setAccessToken(null);
    // Refus du serveur : le token est mort, on l'efface — magasin de l'OS
    // compris. Tout autre échec est transitoire et le laisse en place, en
    // mémoire comme au magasin (cf. `isSessionRejected`).
    const terminal = isSessionRejected(cause);
    if (terminal) setRefreshToken(null);
    return { ok: false, cause, terminal };
  }
}

/**
 * Tente un refresh silencieux, dédupliqué :
 *  - **dans l'onglet** — `refreshInFlight` fait partager le même appel en vol
 *    à tous les appelants concurrents (retry 401 de `api()`, `auth.init()`) ;
 *  - **entre onglets**, mode web seulement — `withCrossTabRefreshLock` (cf.
 *    sa JSDoc pour le protocole).
 *
 * Exportée pour `auth.ts` : `init()` doit passer par ici plutôt que
 * ré-appeler `/auth/refresh` directement, sous peine de recréer exactement
 * la course cross-onglet que cette fonction corrige.
 */
export async function tryRefresh(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  const native = isTauri();
  // En mode natif, le token est la seule source : sans lui l'appel ne peut que
  // renvoyer 401. On s'épargne l'aller-retour et le bruit dans les logs.
  if (native && !refreshTokenInMemory) {
    setAccessToken(null);
    return { ok: false, cause: new Error('no-refresh-token'), terminal: true };
  }
  refreshInFlight = (async () => {
    try {
      // Natif : une seule fenêtre, le verrou cross-onglet serait inoffensif
      // mais inutile — et dépendrait de `localStorage`, exclu par ADR-038.
      return await (native
        ? performRefreshRequest(native)
        : withCrossTabRefreshLock(() => performRefreshRequest(native)));
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
