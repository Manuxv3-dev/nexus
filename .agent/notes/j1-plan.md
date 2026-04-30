# J1 — Plan technique détaillé (backend kernel)

**Date** : 2026-04-30
**Statut** : Proposé, en attente de validation Manu.

## Objectif J1

Un backend Fastify minimal mais "production-shaped" : typage end-to-end,
auth fonctionnelle, observable, testable, prêt à recevoir les routes
métier de J2+.

## Structure des dossiers

```
packages/backend/
├── drizzle/
│   ├── migrations/              # SQL versionné, généré par drizzle-kit
│   └── meta/
├── drizzle.config.ts
├── src/
│   ├── index.ts                 # entrypoint : start server
│   ├── server.ts                # buildServer() — utilisé par les tests aussi
│   ├── core/
│   │   ├── env.ts               # validation Zod des env vars, exporte `env`
│   │   ├── logger.ts            # pino instance partagée
│   │   ├── errors.ts            # AppError class + codes typés
│   │   ├── error-handler.ts     # plugin Fastify : map AppError → HTTP
│   │   ├── define-route.ts      # helper typé (cf. signature ci-dessous)
│   │   └── middlewares/
│   │       └── require-auth.ts  # decorator fastify : req.user
│   ├── db/
│   │   ├── client.ts            # postgres-js + drizzle instance
│   │   ├── schema/
│   │   │   ├── index.ts         # re-export tous
│   │   │   ├── users.ts
│   │   │   ├── groups.ts
│   │   │   ├── group-members.ts
│   │   │   └── refresh-tokens.ts
│   │   └── helpers.ts           # withGroupScope (cf. ADR-005)
│   ├── routes/
│   │   ├── health/
│   │   │   ├── index.ts         # plugin
│   │   │   └── health.ts        # GET /api/v1/health
│   │   └── auth/
│   │       ├── index.ts         # plugin
│   │       ├── schemas.ts       # Zod : LoginBody, RegisterBody, etc.
│   │       ├── service.ts       # logique métier (hash, jwt sign, etc.)
│   │       ├── register.ts      # POST /api/v1/auth/register
│   │       ├── login.ts
│   │       ├── refresh.ts
│   │       ├── logout.ts
│   │       ├── logout-all.ts
│   │       └── me.ts
│   ├── ws/
│   │   ├── index.ts             # plugin Fastify, endpoint /ws
│   │   ├── connection-store.ts  # Map<userId, Set<SocketHandle>>
│   │   ├── auth.ts              # vérifie JWT en query param à l'open
│   │   └── presence.ts          # émet presence:update sur connect/disconnect
│   └── test/
│       ├── setup.ts             # globalSetup Vitest : DB temporaire par run
│       ├── helpers.ts           # buildTestServer(), createTestUser(), etc.
│       └── fixtures.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Schéma DB initial

### `users`

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),       // argon2id
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
}));
```

### `groups`

```ts
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### `group_members`

```ts
export const groupRole = pgEnum('group_role', ['owner', 'admin', 'member']);

export const groupMembers = pgTable('group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: groupRole('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueMembership: uniqueIndex('group_members_group_user_idx').on(t.groupId, t.userId),
  groupIdx: index('group_members_group_idx').on(t.groupId),
  userIdx: index('group_members_user_idx').on(t.userId),
}));
```

### `refresh_tokens`

```ts
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),               // sha256 du UUID v4 émis
  deviceId: text('device_id'),                           // optionnel, fourni par client
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedById: uuid('replaced_by_id'),                  // chaînage rotation
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenHashIdx: uniqueIndex('refresh_tokens_token_hash_idx').on(t.tokenHash),
  userIdx: index('refresh_tokens_user_idx').on(t.userId),
}));
```

Note : la rotation est tracée via `replacedById` → permet audit + détection de
réutilisation d'un refresh révoqué (signal d'attaque).

## Format d'erreur typé

### Côté backend

```ts
// src/core/errors.ts
export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: { http: 401, message: 'Invalid credentials' },
  AUTH_TOKEN_EXPIRED:       { http: 401, message: 'Token expired' },
  AUTH_TOKEN_INVALID:       { http: 401, message: 'Token invalid' },
  AUTH_REFRESH_REVOKED:     { http: 401, message: 'Refresh token revoked' },
  AUTH_REFRESH_REUSED:      { http: 401, message: 'Refresh token reused — all sessions revoked' },
  AUTH_EMAIL_TAKEN:         { http: 409, message: 'Email already registered' },
  AUTH_NOT_AUTHENTICATED:   { http: 401, message: 'Authentication required' },
  // Authorization
  PERMISSION_DENIED:        { http: 403, message: 'Permission denied' },
  GROUP_MEMBERSHIP_REQUIRED:{ http: 403, message: 'Group membership required' },
  // Validation
  VALIDATION_ERROR:         { http: 400, message: 'Validation error' },
  // Resources
  RESOURCE_NOT_FOUND:       { http: 404, message: 'Resource not found' },
  RESOURCE_CONFLICT:        { http: 409, message: 'Resource conflict' },
  // Generic
  RATE_LIMITED:             { http: 429, message: 'Rate limit exceeded' },
  INTERNAL_ERROR:           { http: 500, message: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: unknown,
    cause?: unknown,
  ) {
    super(ERROR_CODES[code].message, cause ? { cause } : undefined);
  }
}
```

### Format JSON renvoyé au client

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid credentials",
    "details": null,
    "requestId": "req_01HZ..."
  }
}
```

`requestId` permet de lier l'erreur côté client à un log structuré côté
backend (corrélation pino + request-id).

### Côté @nexus/shared

Les codes d'erreur sont **dupliqués** dans `@nexus/shared/src/errors.ts` (en
read-only côté client) pour permettre au desktop/mobile de discriminer.
Source de vérité = backend, mais on génère un fichier dérivé via un script
ou copie manuelle (à arbitrer — mon choix : copie manuelle au début, script
de sync si la liste grossit).

## Signature `defineRoute`

```ts
// src/core/define-route.ts
import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { ZodTypeAny, z } from 'zod';

interface DefineRouteOpts<
  Body extends ZodTypeAny | undefined,
  Query extends ZodTypeAny | undefined,
  Params extends ZodTypeAny | undefined,
  Reply extends ZodTypeAny,
> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: Body;
  query?: Query;
  params?: Params;
  reply: Reply;
  preHandlers?: preHandlerHookHandler[];
  handler: (
    req: FastifyRequest & {
      body: Body extends ZodTypeAny ? z.infer<Body> : undefined;
      query: Query extends ZodTypeAny ? z.infer<Query> : unknown;
      params: Params extends ZodTypeAny ? z.infer<Params> : unknown;
    },
    reply: FastifyReply,
  ) => Promise<z.infer<Reply>>;
}

export function defineRoute<
  Body extends ZodTypeAny | undefined = undefined,
  Query extends ZodTypeAny | undefined = undefined,
  Params extends ZodTypeAny | undefined = undefined,
  Reply extends ZodTypeAny = ZodTypeAny,
>(opts: DefineRouteOpts<Body, Query, Params, Reply>) {
  return async (fastify: FastifyInstance) => {
    fastify.route({
      method: opts.method,
      url: opts.url,
      preHandler: opts.preHandlers,
      handler: async (req, reply) => {
        // Validation entrée
        if (opts.body)   req.body   = opts.body.parse(req.body);
        if (opts.query)  req.query  = opts.query.parse(req.query);
        if (opts.params) req.params = opts.params.parse(req.params);
        // Exécution handler
        const result = await opts.handler(req as never, reply);
        // Validation sortie (defensive)
        return opts.reply.parse(result);
      },
    });
  };
}
```

Bénéfices :
- Inférence end-to-end : le `handler` reçoit un `req.body` typé et doit
  retourner `z.infer<Reply>`, sinon erreur de compilation
- Validation entrée + sortie automatique
- preHandlers (auth, group membership) typés via Fastify standard

## Endpoints auth — signatures précises

| Méthode | URL                          | Body                                  | Reply                                            | Auth |
|---------|------------------------------|---------------------------------------|--------------------------------------------------|------|
| POST    | `/api/v1/auth/register`      | `{ email, password, displayName }`    | `{ user, accessToken, refreshToken }`            | ❌   |
| POST    | `/api/v1/auth/login`         | `{ email, password, deviceId? }`      | `{ user, accessToken, refreshToken }`            | ❌   |
| POST    | `/api/v1/auth/refresh`       | `{ refreshToken }`                    | `{ accessToken, refreshToken }` (rotation)       | ❌   |
| POST    | `/api/v1/auth/logout`        | `{ refreshToken }`                    | `{ ok: true }`                                   | ✅   |
| POST    | `/api/v1/auth/logout-all`    | _(rien)_                              | `{ revokedCount }`                               | ✅   |
| GET     | `/api/v1/auth/me`            | _(rien)_                              | `{ user }`                                       | ✅   |
| GET     | `/api/v1/health`             | _(rien)_                              | `HealthStatus` (cf. @nexus/shared)               | ❌   |

### Stratégie refresh

- À chaque `/refresh`, on vérifie le hash en DB. Si valide et non révoqué :
  - On génère un nouveau couple (access + refresh)
  - On révoque l'ancien refresh (`revokedAt` set)
  - On renseigne `replacedById` sur l'ancien
- **Détection de réutilisation** : si on tente de `/refresh` avec un token
  déjà révoqué → on **révoque toute la chaîne** de refresh de cet utilisateur
  (logout-all forcé) et on renvoie `AUTH_REFRESH_REUSED`. C'est le pattern
  standard de protection contre le vol de refresh token.

### Hashing password

- Lib : `argon2` (bindings natifs Node)
- Type : `argon2id`
- Paramètres OWASP 2024 : `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`
- Validation force du password en register : min 12 caractères, pas de check
  complexité bidon (suit les recommandations NIST 800-63B)

## WebSocket — squelette J1

- Plugin `@fastify/websocket`
- Endpoint `wss://.../ws?token=<jwt>`
- À l'ouverture :
  1. Parse `token` query param
  2. Verify JWT (HS256 + secret)
  3. Si valide, attache `userId` et `groupIds` à la connexion
  4. Ajoute la connexion à `connectionStore` (`Map<userId, Set<WS>>`)
  5. Émet `presence:update` à tous les utilisateurs des mêmes groupes
- Heartbeat : ping toutes les 30s, déco si pas de pong sous 60s
- À la fermeture : retire de `connectionStore`, émet `presence:update` (offline)
- Pas de Redis pub/sub en J1 (préparation J3) — on peut faire sans pour
  démarrer, le store local suffit pour un seul process

Format `presence:update` (cf. ADR-003) :
```ts
{ type: 'presence:update', payload: { userId, status: 'online' | 'offline' }, timestamp: number }
```

Schéma défini dans `@nexus/shared/src/ws-protocol.ts` (à créer en J1).

## Variables d'environnement (à compléter `.env.example`)

Déjà présentes dans `.env.example` :
- `NODE_ENV`, `LOG_LEVEL`
- `BACKEND_PORT`, `BACKEND_HOST`
- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`

À ajouter pour J1 :
- `WS_HEARTBEAT_INTERVAL_MS` (default 30000)
- `RATE_LIMIT_AUTH_MAX` (default 10) — login/register/refresh par IP par minute
- Conservons `JWT_REFRESH_SECRET` même si on n'en a pas strictement besoin
  (le refresh token étant un UUID opaque, pas un JWT) — utile pour signer
  un futur "cookie de session" si on en ajoute un.

## Tests

- Vitest + supertest + Postgres réel (pas de mock DB, cf. mémoire d'équipe :
  les tests d'intégration tapent une vraie DB)
- Stratégie : un schema Postgres temporaire par run de test, créé en
  `globalSetup`, droppé en `globalTeardown`
- Sur GitHub Actions : Postgres en service container (rapide, pas de Testcontainers)
- En local : on s'attend à `pnpm compose:up` lancé, et le test crée son schema
- Coverage cible J1 : tous les endpoints auth (cas nominal + erreurs typées)
  + WS auth + presence:update

## Stack de libs (devDependencies + dependencies)

### Production (`@nexus/backend`)
```
fastify ^5
@fastify/jwt ^9
@fastify/cors ^10
@fastify/helmet ^12
@fastify/websocket ^11
@fastify/rate-limit ^10
@fastify/sensible ^6
pino ^9
pino-pretty ^11 (dev only)
drizzle-orm ^0.36
postgres ^3.4 (driver — postgres-js)
ioredis ^5
argon2 ^0.41
zod ^3.23 (déjà via shared)
nanoid ^5 (slugs et requestId)
```

### Dev
```
drizzle-kit ^0.27
@types/node (déjà root)
supertest ^7
@types/supertest
tsx (déjà)
vitest (déjà)
```

## Ordre d'implémentation des sous-jalons

1. **J1a — Setup Fastify + Pino + erreurs typées + env validation** (~ 0.5 j)
   - server.ts, env.ts, logger.ts, errors.ts, error-handler.ts
   - Endpoint `/api/v1/health` qui répond avec le schéma de @nexus/shared
   - Premier test d'intégration : `GET /health` → 200 valide

2. **J1b — Drizzle + premières migrations** (~ 0.5 j)
   - drizzle.config.ts, schema/*, client.ts
   - `pnpm db:generate` → SQL versionné
   - `pnpm db:migrate` → applique
   - Helper de connexion testé contre Postgres local
   - `/health` enrichi avec ping Postgres + Redis

3. **J1c — Helper `defineRoute`** (~ 0.3 j)
   - Implémentation + tests sur un endpoint factice
   - Documentation TSDoc

4. **J1d — Endpoints auth** (~ 1.5 j)
   - register, login, refresh, logout, logout-all, me
   - Service argon2 + JWT
   - Tests d'intégration exhaustifs (cas nominal + 401 + 409 + détection refresh reuse)

5. **J1e — WebSocket + presence** (~ 0.5 j)
   - Plugin WS, auth JWT query param, connection-store, heartbeat
   - Event `presence:update`
   - Test : 2 clients WS → réception du presence:update mutuel

6. **J1f — Stabilisation + CI mise à jour** (~ 0.3 j)
   - Service Postgres dans GitHub Actions
   - Coverage report
   - README backend mis à jour
   - Commit final propre

**Total estimé** : ~3.6 j de dev, marge à ~4-5 jours avec imprévus.

## Skills à créer pendant J1

- `auth-refresh-flow.md` (pendant J1d) — règles strictes de rotation et
  détection de réutilisation
- Mise à jour de `create-api-endpoint.md` une fois `defineRoute` implémenté
  (remplacer le pseudo-code par la vraie signature)

## Décisions à confirmer par Manu

1. ✅ **`postgres-js` comme driver** plutôt que `pg`. Plus moderne, meilleure
   intégration Drizzle, performance équivalente. OK ?
2. ✅ **`argon2id` avec params OWASP 2024** (m=19456, t=2, p=1). OK ?
3. ✅ **JWT HS256** avec secret partagé pour l'access token. Pas de RS256 en V1
   (pas de rotation de clés cross-service à faire). OK ?
4. ✅ **Refresh token = UUID v4 hashé SHA-256**, opaque, pas un JWT. Rotation
   à chaque `/refresh`. Détection de réutilisation = revoke all chain. OK ?
5. ✅ **Postgres réel en CI** (service container) plutôt que Testcontainers.
   Plus rapide, plus simple. OK ?
6. ✅ **Format d'erreur** `{ error: { code, message, details, requestId } }`.
   Compatible avec ce que TanStack Query / fetch consomment naturellement. OK ?
7. ✅ **Validation password en register** : min 12 caractères, pas de check de
   complexité (recommandation NIST). OK ?
