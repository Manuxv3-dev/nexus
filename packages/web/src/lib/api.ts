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

const API_BASE = '/api/v1';

let accessTokenInMemory: string | null = null;
let onAuthExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessTokenInMemory = token;
}
export function getAccessToken(): string | null {
  return accessTokenInMemory;
}
export function setOnAuthExpired(handler: (() => void) | null) {
  onAuthExpired = handler;
}

function readCsrfFromCookie(): string | null {
  const m = /(?:^|; )nexus_csrf=([^;]+)/.exec(document.cookie);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
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

async function rawFetch<TReply>(opts: ApiOptions<unknown, TReply>): Promise<TReply> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    'X-Nexus-Client': 'web',
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
    const payload = (data ?? {
      code: 'UNKNOWN_ERROR',
      message: `HTTP ${res.status}`,
    }) as ApiErrorPayload;
    throw new ApiError(res.status, payload);
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
      const refreshed = await tryRefresh();
      if (refreshed) {
        return await rawFetch({ ...opts, noRetry: true });
      }
      onAuthExpired?.();
    }
    throw err;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

const RefreshReplySchema = z.object({
  accessToken: z.string(),
});

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const reply = await rawFetch({
        method: 'POST',
        path: '/auth/refresh',
        body: {},
        reply: RefreshReplySchema,
        noRetry: true,
        unauthenticated: true,
      });
      setAccessToken(reply.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
