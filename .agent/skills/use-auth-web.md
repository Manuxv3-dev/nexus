# Skill — Auth web (cookie + CSRF)

**Quand l'utiliser** : côté client web (`@nexus/web`), pour consommer les
endpoints `/api/v1/auth/*` en mode cookie + CSRF (cf. ADR-015).

## TL;DR

- Login/register : envoyer `X-Nexus-Client: web` ET `credentials: 'include'`
- Refresh/logout : envoyer le header `X-CSRF-Token` lu depuis le cookie
  `nexus_csrf` ET `credentials: 'include'`
- L'access token revient en JSON body (à garder en mémoire React, pas
  persister)
- Le refresh token est posé par le serveur en cookie `httpOnly`, jamais
  visible côté JS

## Pattern fetch wrapper

```ts
// packages/web/src/lib/api.ts

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.nexusapp.chat';

let accessTokenInMemory: string | null = null;

export function setAccessToken(token: string | null): void {
  accessTokenInMemory = token;
}

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)nexus_csrf=([^;]+)/);
  return match?.[1] ?? null;
}

interface ApiOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  /** Si true, envoie le header X-CSRF-Token (mutating + auth required). */
  needsCsrf?: boolean;
}

export async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Nexus-Client': 'web',
    'Content-Type': 'application/json',
  };

  if (accessTokenInMemory) {
    headers['Authorization'] = `Bearer ${accessTokenInMemory}`;
  }

  if (opts.needsCsrf) {
    const csrf = readCsrfCookie();
    if (!csrf) throw new Error('CSRF token absent — re-login required');
    headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include', // CRITIQUE : envoie/reçoit les cookies cross-origin
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && accessTokenInMemory) {
    // Tenter un refresh transparent
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, opts); // retry une fois
    throw new ApiError(401, 'AUTH_NOT_AUTHENTICATED');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? code);
  }
}
```

## Refresh transparent + multi-tabs

```ts
// packages/web/src/lib/auth.ts

let refreshPromise: Promise<boolean> | null = null;

const refreshChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('nexus-auth-refresh')
  : null;

refreshChannel?.addEventListener('message', (e) => {
  if (e.data?.type === 'refreshed' && typeof e.data.accessToken === 'string') {
    setAccessToken(e.data.accessToken);
  }
});

export async function tryRefresh(): Promise<boolean> {
  // Si un refresh est déjà en cours dans cet onglet → attend le même
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const csrf = readCsrfCookie();
      if (!csrf) return false;

      const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-Nexus-Client': 'web',
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) return false;

      const { accessToken } = await res.json() as { accessToken: string };
      setAccessToken(accessToken);
      // Diffuser aux autres onglets pour qu'ils n'attendent pas le même
      refreshChannel?.postMessage({ type: 'refreshed', accessToken });
      return true;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
```

## Login flow

```ts
import { api, setAccessToken } from './api';

export async function login(email: string, password: string): Promise<User> {
  const { user, accessToken } = await api<{ user: User; accessToken: string }>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      body: { email, password },
    },
  );
  setAccessToken(accessToken);
  return user;
}
```

Pas besoin de stocker le refresh token côté JS : il est en cookie httpOnly,
le navigateur l'envoie automatiquement aux endpoints `/api/v1/auth/*` (path
configuré côté serveur).

## Logout flow

```ts
export async function logout(): Promise<void> {
  await api('/api/v1/auth/logout', {
    method: 'POST',
    needsCsrf: true,
    body: {},
  });
  setAccessToken(null);
}
```

## Erreurs à gérer côté UI

| Code                     | HTTP | Quand                                       | Action UI |
|--------------------------|------|---------------------------------------------|-----------|
| `AUTH_INVALID_CREDENTIALS` | 401 | login email/password incorrect              | Toast erreur, garder le formulaire |
| `AUTH_TOKEN_INVALID`     | 401  | refresh impossible (token introuvable)      | Logout + redirect /login |
| `AUTH_TOKEN_EXPIRED`     | 401  | refresh expiré (>30j)                       | Logout + redirect /login |
| `AUTH_REFRESH_REUSED`    | 401  | détection de réutilisation (vol potentiel)  | Logout + redirect + toast "Session compromise" |
| `AUTH_CSRF_MISMATCH`     | 403  | header CSRF absent ou mauvais              | Logout (probablement onglet périmé) + redirect /login |
| `AUTH_NOT_AUTHENTICATED` | 401  | pas d'access token / expiré sans refresh    | Logout + redirect /login |

## Dev local : CORS et cookies

En dev (`http://localhost:3000` API + `http://localhost:5173` web Vite),
les cookies cross-origin marchent à condition de :
- Backend : `cors({ origin: 'http://localhost:5173', credentials: true })`
  (ce qui est déjà le cas en NODE_ENV=development où on accepte tous les origins)
- Frontend : `fetch(..., { credentials: 'include' })` (toujours)
- Cookie `Secure` : false en dev (sinon Chrome refuse les cookies non-HTTPS)
  → géré par `setAuthCookies` qui regarde NODE_ENV

En prod, tout est sur `*.nexusapp.chat` (same-site), donc `SameSite=Strict`
fonctionne nativement.

## À ne PAS faire

- ❌ Stocker l'access token dans `localStorage` ou `sessionStorage`
- ❌ Stocker le refresh token côté JS (il est en cookie httpOnly de toute
  façon, mais ne JAMAIS essayer de le lire)
- ❌ Désactiver le `credentials: 'include'` (les cookies ne partent plus)
- ❌ Construire un fetch wrapper sans gestion du retry-after-refresh
- ❌ Faire 2 refresh en parallèle dans 2 onglets (utiliser BroadcastChannel)

## Tests à prévoir côté web

À l'heure où ce skill est rédigé (J3.0), il n'y a pas encore de tests web.
Quand `@nexus/web` sera scaffoldé en J4a, prévoir :
- Test du fetch wrapper : retry-after-refresh, propagation d'erreurs
- Test de `tryRefresh` : single-flight (pas de double appel parallèle)
- Test multi-tabs avec BroadcastChannel mocké

## Références

- ADR-015 (auth web cookie + CSRF) — la décision d'architecture
- ADR-004 (auth JWT + refresh) — base des deux modes
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet
- Plugin Fastify `core/csrf.ts` côté backend
- Tests d'intégration mode web : `routes/auth/auth.test.ts`
