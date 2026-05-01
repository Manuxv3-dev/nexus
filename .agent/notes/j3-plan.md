# J3 — Plan technique détaillé (Architecture bridges + Discord)

**Date** : 2026-05-01
**Statut** : Proposé, en attente de validation Manu.
**Estimation totale** : 1.5 à 2 semaines.

## Objectif J3

Poser l'architecture commune des bridges (cf. ADR-009) en branchant Discord
comme première implémentation, plus livrer le mode auth web cookie+CSRF
prévu par ADR-015 pour que la web app de J4 ait son backend prêt.

À la fin de J3, le critère de validation est :
- Un user enregistre Nexus comme bot Discord dans son serveur
- Le worker bridge se connecte à la gateway Discord
- Un message envoyé dans Discord apparaît sur le WS Nexus en < 2 s
- Un message envoyé via API Nexus arrive dans Discord
- Le worker peut être restarté sans perdre la connexion gateway
- Une web app peut se logger via mode cookie (testée via curl/Postman)

## Découpage et ordre (validé option α)

```
J3.0  Auth web cookie + CSRF                       1-2 j
  └── pré-requis pour J4-pre / J4 mais pas pour la suite de J3

J3a   Architecture commune bridges                 4-5 j
  ├── interface MessagingProvider
  ├── schémas DB (sessions, channels, messages)
  ├── module integrations/core/ (encryption, session-store, registry, event-bus)
  └── pattern worker BullMQ + lock Redis

J3b   Discord provider + worker                    3-4 j
  ├── DiscordProvider (discord.js v14)
  ├── OAuth bot install flow (signed state + callback)
  └── worker discord-bridge (singleton, gère tous les guilds)

J3c   Propagation events + WS                      2-3 j
  ├── Redis pub/sub topics (worker → backend)
  ├── WS events typés (message:new, edit, delete)
  └── filtrage par membership groupe

J3d   Tests + stabilisation + récap                2 j
  ├── unit : encryption, session-store
  ├── integration : event bus + endpoints
  └── E2E manuel Discord
```

Dépendances dures :
- J3a doit être complet avant J3b (le bridge Discord consomme l'archi commune)
- J3c dépend de J3a (pub/sub) + J3b (un provider qui produit des events)
- J3d clôture
- J3.0 est indépendant du reste, peut être fait en parallèle si nécessaire,
  mais on le fait en premier pour conformité option α.

---

## J3.0 — Auth web mode cookie + CSRF (1-2 j)

Cf. ADR-015. On ajoute le mode "web" aux endpoints auth existants sans
casser le mode "native" actuel.

### Fichiers ajoutés / modifiés

```
packages/backend/src/
├── core/
│   ├── errors.ts                          [+ AUTH_CSRF_MISMATCH]
│   └── plugins/
│       └── csrf-protection.ts             [NOUVEAU]
└── routes/auth/
    ├── service.ts                         [+ helpers cookie + générateur CSRF token]
    ├── schemas.ts                         [+ headers schema X-Nexus-Client]
    └── index.ts                           [endpoints modifiés]
.agent/skills/
└── use-auth-web.md                        [NOUVEAU skill]
```

### Logique

**Détection mode** : header `X-Nexus-Client: web` sur `/auth/login` et
`/auth/register` → mode web ; sinon mode native.

**Login/register en mode web** :
1. Backend authentifie comme avant (vérif credentials)
2. Génère un access token (JWT, inchangé)
3. Génère un refresh token (UUID, inchangé) → enregistré DB
4. Génère un CSRF token (32 bytes hex random)
5. Pose deux cookies dans la réponse :
   - `nexus_refresh` : value = refresh token, `httpOnly + Secure +
     SameSite=Strict + Path=/api/v1/auth + Max-Age=30j`
   - `nexus_csrf` : value = csrf token, `Secure + SameSite=Strict +
     Path=/ + Max-Age=30j` (lisible par JS volontairement)
6. Retourne JSON `{ user, accessToken }` (PAS de refreshToken dans le body)

**Refresh en mode web** :
1. Pas de body (ou body vide) → on lit le cookie `nexus_refresh`
2. Le client a fourni `X-CSRF-Token: <value>` → on compare au cookie `nexus_csrf`
3. Si mismatch → `AppError('AUTH_CSRF_MISMATCH', 403)`
4. Si match → flow refresh classique (rotation refresh, regenerate access)
5. Pose nouveau `nexus_refresh` cookie + nouveau `nexus_csrf` cookie
6. Retourne JSON `{ accessToken }` (pas de refreshToken)

**Logout en mode web** : supprime les cookies (`Max-Age=0`) + revoke DB.

### Plugin `csrf-protection.ts`

```ts
// fastify plugin qui :
// - décore l'instance avec une méthode `validateCsrf(req)` utilitaire
// - n'agit pas globalement : c'est aux endpoints en mode web de l'invoquer

export async function validateCsrf(req: FastifyRequest): Promise<void> {
  const cookieValue = req.cookies?.['nexus_csrf'];
  const headerValue = req.headers['x-csrf-token'];
  if (!cookieValue || !headerValue || cookieValue !== headerValue) {
    throw new AppError('AUTH_CSRF_MISMATCH');
  }
}
```

Pour parser les cookies on installe `@fastify/cookie` (déjà dans
l'écosystème Fastify, maintenu).

### Détection robuste mode web

On regarde dans cet ordre :
1. Présence header `X-Nexus-Client: web` (explicite)
2. Sinon : présence cookie `nexus_refresh` (l'user a déjà eu une session web)
3. Sinon : mode native (body-token)

L'implémentation : dans `/auth/refresh`, si body absent ET cookie présent →
mode web. Si body présent ET cookie absent → mode native. Si les deux → erreur
`VALIDATION_ERROR` (configuration ambiguë, signal d'attaque potentielle).

### Tests

Étendre `auth.test.ts` :
- Login web : vérifie que la réponse contient les Set-Cookie (httpOnly,
  secure, samesite=strict)
- Login web : vérifie que `refreshToken` n'est PAS dans le body JSON
- Refresh web : avec cookie + header CSRF → 200 + nouveaux cookies
- Refresh web : avec cookie mais sans header → 403 AUTH_CSRF_MISMATCH
- Refresh web : avec cookie + mauvais header → 403 AUTH_CSRF_MISMATCH
- Logout web : cookies vidés, refresh révoqué en DB
- Mode native : tests existants doivent toujours passer

### Skill `.agent/skills/use-auth-web.md`

Document court qui explique côté front comment consommer le mode web :
fetch wrapper, lecture du cookie csrf via `document.cookie`, BroadcastChannel
multi-tabs.

### Dépendances ajoutées

`@fastify/cookie@^11.0.0` dans `packages/backend/package.json`.

### Critère de validation J3.0

`auth.test.ts` étendu passe en CI. Test manuel via curl :

```bash
# Login en mode web
curl -i -c cookies.txt -H "X-Nexus-Client: web" -H "Content-Type: application/json" \
  -d '{"email":"a@b.c","password":"password-12chars"}' \
  http://localhost:3000/api/v1/auth/login
# → Set-Cookie: nexus_refresh=...; HttpOnly; Secure; SameSite=Strict
# → Set-Cookie: nexus_csrf=...; Secure; SameSite=Strict
# → JSON { user, accessToken }

# Refresh avec cookies + header CSRF
CSRF=$(grep nexus_csrf cookies.txt | awk '{print $7}')
curl -i -b cookies.txt -H "X-CSRF-Token: $CSRF" \
  http://localhost:3000/api/v1/auth/refresh
# → 200 + nouveaux Set-Cookie
```

---

## J3a — Architecture commune des bridges (4-5 j)

Cf. ADR-009. Le cœur structurant : interface, schémas DB, module core,
pattern worker.

### Fichiers ajoutés

```
packages/shared/src/
└── messaging/
    ├── provider.ts                        [interface MessagingProvider + types]
    ├── events.ts                          [ProviderEvent normalisé]
    └── index.ts                           [re-exports]

packages/backend/src/
├── db/schema/index.ts                     [+ messaging_provider_sessions, messaging_channels, messaging_messages]
├── integrations/
│   ├── core/
│   │   ├── encryption.ts                  [AES-256-GCM]
│   │   ├── encryption.test.ts             [unit]
│   │   ├── session-store.ts               [CRUD sessions chiffrées]
│   │   ├── session-store.test.ts          [unit + integration]
│   │   ├── bridge-registry.ts             [factory map providerType → impl]
│   │   ├── event-bus.ts                   [Redis pub/sub publisher + subscriber]
│   │   └── types.ts                       [types internes au module]
│   └── README.md                          [doc opérateur du module]
└── workers/
    ├── bridge-worker.ts                   [base class abstract]
    └── README.md                          [doc lifecycle worker]

packages/backend/drizzle/migrations/
└── 0002_add_messaging_tables.sql          [généré par drizzle-kit]

packages/backend/.env.example              [+ ENCRYPTION_KEY_BRIDGES]
```

### Interface `MessagingProvider`

Définie dans `@nexus/shared/messaging/provider.ts` (TypeScript only, pas
de logique).

```ts
export type ProviderType = 'discord' | 'whatsapp' | 'messenger';

export interface ProviderCapabilities {
  sendMessage: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  reactions: boolean;
  attachments: boolean;
  voice: boolean;          // V2+
  threads: boolean;        // V2+
  presence: boolean;
  typingIndicator: boolean;
}

export interface SendMessageInput {
  channelId: string;       // externalChannelId du provider
  content: string;
  replyToId?: string | null;
  attachments?: AttachmentRef[];
}

export interface SendMessageResult {
  externalMessageId: string;
  sentAt: Date;
}

export interface MessagingProvider {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  /** Démarre la connexion gateway / WebSocket / polling. */
  connect(): Promise<void>;

  /** Coupe proprement (déconnecte gateway, libère ressources). */
  disconnect(): Promise<void>;

  /** Envoie un message. Throw si capability absente. */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /** Récupère les messages d'un channel, paginé par cursor. */
  fetchHistory(input: {
    channelId: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ messages: ProviderMessage[]; nextCursor: string | null }>;

  /** Liste les channels disponibles pour cette session. */
  listChannels(): Promise<ProviderChannel[]>;

  /** Statut courant. */
  getStatus(): ProviderStatus;
}

export type ProviderStatus =
  | { kind: 'connecting' }
  | { kind: 'connected'; since: Date }
  | { kind: 'disconnected'; reason: string; lastConnectedAt: Date | null }
  | { kind: 'error'; error: string; retryAt: Date | null };
```

Les implémentations vivent dans `packages/backend/src/integrations/discord/`,
etc. Le `@nexus/shared` ne contient que les types (les implémentations
node-only ne peuvent pas être dans shared qui doit aussi être browser-safe
pour les types côté @nexus/web).

### Schéma DB

**Table `messaging_provider_sessions`** : un rattachement entre un groupe
Nexus et un compte/serveur externe. **Ce n'est pas une connexion réseau
au sens strict** (cf. discussion bot Discord vs comptes WhatsApp).

```sql
CREATE TABLE messaging_provider_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  provider_type   TEXT NOT NULL,                      -- 'discord' | 'whatsapp' | 'messenger'
  external_id     TEXT NOT NULL,                       -- guildId Discord, phone WhatsApp, fbId Messenger
  display_name    TEXT NOT NULL,                       -- nom affiché côté UI Nexus
  encrypted_credentials  BYTEA,                        -- AES-256-GCM, NULL pour Discord (bot global)
  status          TEXT NOT NULL DEFAULT 'connecting', -- 'connecting'|'connected'|'disconnected'|'error'
  status_detail   TEXT,
  last_connected_at TIMESTAMPTZ,
  last_error      TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messaging_sessions_provider_external_idx
  ON messaging_provider_sessions(provider_type, external_id);
CREATE INDEX messaging_sessions_group_idx ON messaging_provider_sessions(group_id);
```

Note importante : `(provider_type, external_id)` est unique → on ne peut
pas avoir deux groupes Nexus qui revendiquent le même guild Discord. Ça
correspond à la réalité : un serveur Discord est rattaché à un seul
groupe Nexus.

**Table `messaging_channels`** : les channels (textuels) au sein d'une
session, mappés à des conversations Nexus.

```sql
CREATE TABLE messaging_channels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES messaging_provider_sessions(id) ON DELETE CASCADE,
  external_channel_id TEXT NOT NULL,         -- channelId Discord, threadId WhatsApp, etc.
  name                TEXT NOT NULL,
  channel_type        TEXT NOT NULL,         -- 'text' | 'dm' | 'group_dm' (V2)
  is_archived         BOOLEAN NOT NULL DEFAULT FALSE,
  metadata            JSONB,                 -- topic, position, etc.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messaging_channels_session_external_idx
  ON messaging_channels(session_id, external_channel_id);
CREATE INDEX messaging_channels_session_idx ON messaging_channels(session_id);
```

**Table `messaging_messages`** : cache local des messages (pour pagination
historique sans tape Discord à chaque coup, et pour offline read PWA).

```sql
CREATE TABLE messaging_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID NOT NULL REFERENCES messaging_channels(id) ON DELETE CASCADE,
  external_message_id TEXT NOT NULL,
  external_author_id  TEXT NOT NULL,             -- Discord userId, WhatsApp jid, etc.
  author_display_name TEXT NOT NULL,
  author_avatar_url   TEXT,
  content             TEXT NOT NULL,             -- text/markdown selon le provider
  reply_to_external_id TEXT,
  attachments         JSONB,                     -- [{ url, type, size, name }]
  reactions           JSONB,                     -- [{ emoji, count, byMe }]
  is_edited           BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  external_created_at TIMESTAMPTZ NOT NULL,
  external_edited_at  TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messaging_messages_channel_external_idx
  ON messaging_messages(channel_id, external_message_id);
CREATE INDEX messaging_messages_channel_created_idx
  ON messaging_messages(channel_id, external_created_at DESC);
```

`external_created_at DESC` est le clustering pour les requêtes paginées
("derniers messages d'abord").

### Module `integrations/core/encryption.ts`

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY = Buffer.from(process.env.ENCRYPTION_KEY_BRIDGES!, 'base64'); // 32 bytes
const IV_LENGTH = 12; // GCM standard

export function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout : iv (12) || authTag (16) || ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = blob.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

`ENCRYPTION_KEY_BRIDGES` validé par Zod env (32 bytes après base64-decode).
Génération : `openssl rand -base64 32`.

### Module `integrations/core/session-store.ts`

CRUD wrapper sur la table `messaging_provider_sessions` qui chiffre/déchiffre
les credentials transparently.

```ts
export async function createSession(input: {
  groupId: string;
  providerType: ProviderType;
  externalId: string;
  displayName: string;
  credentials?: object;       // sera JSON-stringifié et chiffré
  createdBy: string;
}): Promise<ProviderSession>;

export async function findSession(id: string): Promise<ProviderSession | null>;
export async function findSessionByExternal(
  providerType: ProviderType,
  externalId: string,
): Promise<ProviderSession | null>;
export async function listSessionsForGroup(groupId: string): Promise<ProviderSession[]>;
export async function listAllSessions(): Promise<ProviderSession[]>;  // utilisé par worker au boot
export async function updateSessionStatus(
  id: string,
  status: ProviderStatus,
): Promise<void>;
export async function deleteSession(id: string): Promise<void>;

export async function getCredentials<T>(sessionId: string): Promise<T | null>;
export async function setCredentials<T>(sessionId: string, creds: T): Promise<void>;
```

### Module `integrations/core/bridge-registry.ts`

Map statique providerType → implementation class. Chaque sous-module
(`integrations/discord`, etc.) auto-enregistre via une fonction d'init.

```ts
const registry = new Map<ProviderType, ProviderConstructor>();

export function registerProvider(type: ProviderType, ctor: ProviderConstructor): void;
export function createProvider(
  type: ProviderType,
  session: ProviderSession,
): MessagingProvider;
```

### Module `integrations/core/event-bus.ts`

Publisher (côté worker) + Subscriber (côté backend HTTP) sur Redis pub/sub.

Topics :
- `bridge:event:<providerType>` : events normalisés émis par les workers
  - payload : `{ sessionId, channelId?, kind: 'message:new'|'message:edit'|..., data }`
- `bridge:control:<providerType>` : commandes de contrôle envoyées par
  l'API HTTP au worker (ex. "tu as une nouvelle session, prends-la en compte")
  - payload : `{ kind: 'session:added'|'session:removed'|'reconnect', sessionId }`

```ts
export async function publishBridgeEvent(event: BridgeEvent): Promise<void>;
export function subscribeBridgeEvents(handler: (e: BridgeEvent) => void): Promise<void>;
export async function publishControl(cmd: BridgeControl): Promise<void>;
export function subscribeControl(
  providerType: ProviderType,
  handler: (cmd: BridgeControl) => void,
): Promise<void>;
```

Implémentation : deux clients ioredis distincts (un publisher, un subscriber)
parce que Redis pub/sub est unidirectionnel par client.

### Pattern worker BullMQ

Pour J3 on a UN type de worker : `discord-bridge`. Mais on pose le pattern
dès maintenant pour réutiliser en J7-J8.

Caractéristiques :
- **Process séparé** lancé via `node dist/workers/discord-bridge.js` ou
  équivalent en dev (`tsx watch src/workers/discord-bridge.ts`)
- **Lock Redis** pour éviter qu'un même worker tourne en double (utile
  quand on aura plusieurs replicas) — clé `lock:bridge:discord`, expiration
  60s, refresh toutes les 30s, le worker actif renouvelle, un autre worker
  bloqué attend que la clé expire
- **Reconnect on restart** : au boot, le worker liste toutes les sessions
  Discord active (`status='connected'` ou `'connecting'`), repart avec leur
  config
- **Dynamic add/remove** : abonné au topic `bridge:control:discord`, prend
  en compte les nouvelles sessions sans restart

Pour J3, on n'a **pas encore de queue BullMQ** au sens de jobs en attente —
le worker tourne en continu, il n'a pas de `queue.add()` côté API. BullMQ
ne sera utilisé qu'à partir de J3b pour les jobs `historySync` (paginés et
idempotents). Pour J3a on installe juste `bullmq` + `ioredis` mais sans
définir de queue.

### Variables d'env ajoutées

```
ENCRYPTION_KEY_BRIDGES=<32 bytes en base64>
DISCORD_BOT_TOKEN=<vide pour l'instant, rempli en J3b>
DISCORD_CLIENT_ID=<vide pour l'instant>
DISCORD_CLIENT_SECRET=<vide pour l'instant>
PUBLIC_BASE_URL=http://localhost:3000   # pour les redirect_uri OAuth en dev
```

### Tests J3a

**Unit** (`encryption.test.ts`) :
- encrypt → decrypt round-trip ASCII, UTF-8, JSON, blob de 10KB
- decrypt avec authTag corrompu → throw
- decrypt avec mauvaise clé → throw
- encrypts différents pour le même plaintext (IV random) — vérifie qu'on
  voit que le ciphertext diffère

**Unit + integration** (`session-store.test.ts`) :
- create / find / update / delete cycle
- credentials chiffrées en DB (lecture brute → on ne lit pas le plaintext)
- contrainte unique `(provider_type, external_id)`
- find inexistant → null
- listAllSessions au boot

### Critère de validation J3a

- Migration `0002_add_messaging_tables.sql` appliquée propre en CI
- `pnpm test` passe avec encryption + session-store tests
- Le worker `discord-bridge` est démarrable mais ne fait rien (pas encore
  de provider implémenté) → c'est J3b

---

## J3b — Implémentation Discord (3-4 j)

### Décision structurante : 1 worker singleton pour TOUS les guilds

Un bot Discord = une seule connexion Gateway pour tous les serveurs où le
bot est ajouté. Le worker `discord-bridge` est un **singleton** : un seul
process qui :
1. Lit toutes les `messaging_provider_sessions` de type `discord` au boot
2. Démarre UN client `discord.js` avec `DISCORD_BOT_TOKEN` (du `.env`,
   pas par-session)
3. À chaque event Discord, lookup la session via `guildId → externalId` et
   publie sur Redis pub/sub
4. Écoute les events de contrôle pour prendre en compte les nouveaux guilds
   ajoutés en cours de route

C'est différent de WhatsApp (J7) ou Messenger (J8) où chaque session est
sa propre connexion → 1 worker par session, isolation forte.

### Fichiers ajoutés

```
packages/backend/src/
├── integrations/
│   └── discord/
│       ├── provider.ts                    [DiscordProvider implements MessagingProvider]
│       ├── oauth.ts                       [signed state, callback, install URL]
│       ├── mapper.ts                      [Discord types → ProviderEvent normalisés]
│       ├── client.ts                      [factory client discord.js + cache]
│       └── index.ts                       [register dans bridge-registry]
├── routes/
│   └── messaging/
│       ├── index.ts                       [plugin]
│       ├── schemas.ts                     [Zod]
│       ├── service.ts                     [logique métier]
│       ├── sessions.ts                    [CRUD endpoints sessions]
│       ├── channels.ts                    [GET channels]
│       ├── messages.ts                    [GET messages, POST send]
│       └── discord-oauth.ts               [GET install-url, GET callback]
└── workers/
    └── discord-bridge.ts                  [worker singleton]

packages/backend/.env.example              [DISCORD_BOT_TOKEN, etc. décommentés]
```

### Setup Discord côté Manu (one-shot, hors code)

Avant que le code marche, Manu doit :
1. Aller sur https://discord.com/developers/applications
2. Créer une application "Nexus" (icône + description)
3. Dans "Bot" : Add Bot, copier le Token → `DISCORD_BOT_TOKEN` dans `.env`
4. Activer "Message Content Intent" et "Server Members Intent" (privileged
   intents nécessaires pour lire les messages)
5. Dans "OAuth2" : copier Client ID + Client Secret → `.env`
6. Ajouter le redirect URI : `http://localhost:3000/api/v1/messaging/discord/oauth/callback`
   (dev) et `https://api.nexusapp.chat/api/v1/messaging/discord/oauth/callback`
   (prod)

À documenter dans `.agent/skills/integrate-messaging-platform.md` (à mettre
à jour, le skill existe déjà depuis J0).

### OAuth bot install flow

Endpoint `GET /api/v1/groups/:groupId/messaging/discord/install-url`
(authentifié, admin+ requis) :
1. Génère un `state` signé : `HMAC-SHA256(serverSecret, JSON({ groupId, userId, ts }))`
   → base64url
2. Construit l'URL Discord OAuth :
   ```
   https://discord.com/oauth2/authorize?
     client_id=$DISCORD_CLIENT_ID&
     scope=bot+applications.commands&
     permissions=$DISCORD_BOT_PERMISSIONS&
     state=$state&
     redirect_uri=$PUBLIC_BASE_URL/api/v1/messaging/discord/oauth/callback
   ```
3. Retourne `{ installUrl }` au client

Le client redirige le user vers Discord. Le user choisit son serveur,
autorise les permissions, Discord redirige vers le callback.

Endpoint `GET /api/v1/messaging/discord/oauth/callback?code=&state=&guild_id=` :
1. Vérifie la signature HMAC du `state`
2. Vérifie la fraîcheur (`ts` < 10 min)
3. Vérifie que le `groupId` du state existe + que `userId` est admin+
   du groupe (re-check membership en DB)
4. Échange le `code` contre un access_token via `POST https://discord.com/api/oauth2/token`
   (juste pour valider — on n'a pas vraiment besoin du token user, le bot
   est dans le serveur)
5. Récupère les infos du guild via `GET https://discord.com/api/guilds/$guild_id`
   (avec le bot token)
6. Crée une `messaging_provider_session` (groupId, providerType='discord',
   externalId=guildId, displayName=guild.name)
7. Publish `bridge:control:discord` `{ kind: 'session:added', sessionId }`
   → le worker prend en compte le nouveau guild
8. Redirect vers la web app sur une page de confirmation
   (`https://app.nexusapp.chat/groups/$groupId/messaging/connected?provider=discord`)

`DISCORD_BOT_PERMISSIONS` : on demande le minimum nécessaire (`Read
Messages`, `Send Messages`, `Read Message History`, `Manage Webhooks`
optionnel pour V2, etc.) — calculé via le bit-field Discord. À noter dans
le skill `integrate-messaging-platform.md`.

### `DiscordProvider` (`integrations/discord/provider.ts`)

```ts
import { Client, GatewayIntentBits } from 'discord.js';

export class DiscordProvider implements MessagingProvider {
  readonly type = 'discord' as const;
  readonly capabilities = {
    sendMessage: true, editMessage: true, deleteMessage: true,
    reactions: true, attachments: true, voice: false,
    threads: false, presence: true, typingIndicator: true,
  };

  constructor(
    private readonly session: ProviderSession,
    private readonly client: Client,    // shared singleton
  ) {}

  async connect(): Promise<void> {
    // No-op : la connexion est gérée par le worker singleton.
    // Cette méthode existe pour la conformité d'interface.
  }

  async disconnect(): Promise<void> {
    // Dans le cas Discord, on ne déconnecte pas le client (partagé).
    // Pour "disconnect" on pourrait retirer le bot du serveur via
    // l'API Discord, mais on garde ça pour V2 (action manuelle user).
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const channel = await this.client.channels.fetch(input.channelId);
    if (!channel?.isTextBased()) throw new AppError('VALIDATION_ERROR');
    const sent = await channel.send({
      content: input.content,
      reply: input.replyToId ? { messageReference: input.replyToId } : undefined,
    });
    return { externalMessageId: sent.id, sentAt: sent.createdAt };
  }

  async fetchHistory(input): Promise<...> { /* discord.js channel.messages.fetch */ }
  async listChannels(): Promise<ProviderChannel[]> { /* guild.channels filter text */ }
  getStatus(): ProviderStatus { return { kind: 'connected', since: this.client.readyAt! }; }
}
```

### Worker `discord-bridge.ts`

Process séparé. Pseudo-code :

```ts
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { mapDiscordEvent } from './integrations/discord/mapper';
import { publishBridgeEvent } from './integrations/core/event-bus';
import { listAllSessions } from './integrations/core/session-store';
import { acquireLock } from './workers/lock';

async function main() {
  await acquireLock('lock:bridge:discord');  // anti-doublon
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.on(Events.ClientReady, async () => {
    logger.info('Discord client ready');
    const sessions = await listAllSessions();
    const discordSessions = sessions.filter(s => s.providerType === 'discord');
    // Vérifie que le bot est bien dans tous les guilds attendus
    for (const s of discordSessions) {
      const guild = client.guilds.cache.get(s.externalId);
      if (!guild) {
        await updateSessionStatus(s.id, { kind: 'error', error: 'bot_not_in_guild', retryAt: null });
      } else {
        await updateSessionStatus(s.id, { kind: 'connected', since: new Date() });
      }
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot && msg.author.id === client.user!.id) return;  // ignore self
    const event = await mapDiscordEvent('message:new', msg);
    if (event) await publishBridgeEvent(event);
  });

  client.on(Events.MessageUpdate, async (oldMsg, newMsg) => { /* publish edit */ });
  client.on(Events.MessageDelete, async (msg) => { /* publish delete */ });
  client.on(Events.MessageReactionAdd, /* ... */);

  // Listen for control commands
  await subscribeControl('discord', async (cmd) => {
    if (cmd.kind === 'session:added') {
      // Recheck membership, set status connected
      const session = await findSession(cmd.sessionId);
      if (session) {
        const guild = client.guilds.cache.get(session.externalId);
        await updateSessionStatus(session.id,
          guild
            ? { kind: 'connected', since: new Date() }
            : { kind: 'error', error: 'bot_not_in_guild', retryAt: null }
        );
      }
    }
  });

  await client.login(process.env.DISCORD_BOT_TOKEN);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await client.destroy();
    process.exit(0);
  });
}

main().catch(err => { logger.fatal(err); process.exit(1); });
```

### Endpoints REST messaging

Plugin `routes/messaging/index.ts`. Tous sous `/api/v1/groups/:groupId/messaging/*`,
preHandlers `[requireAuth, requireGroupMembership]` sauf `/discord/oauth/callback`
qui est public.

```
GET    /groups/:groupId/messaging/sessions               # lister les sessions actives
DELETE /groups/:groupId/messaging/sessions/:sessionId    # déconnecter (admin+)

GET    /groups/:groupId/messaging/discord/install-url    # admin+, retourne installUrl
GET    /messaging/discord/oauth/callback                 # public (Discord redirige ici)

GET    /groups/:groupId/messaging/channels               # tous les channels du groupe
GET    /groups/:groupId/messaging/channels/:channelId/messages?cursor=&limit=
POST   /groups/:groupId/messaging/channels/:channelId/messages    # body: { content, replyTo? }
```

Le `POST messages` :
1. Validate `requireGroupMembership`
2. Lookup `messaging_channels` → `messaging_provider_sessions`
3. Vérifie que la session appartient bien à ce groupe (anti-leak)
4. Récupère le provider via `bridge-registry.createProvider(type, session)`
5. Appelle `provider.sendMessage(...)`
6. Persiste dans `messaging_messages` (le message bot apparaîtra aussi
   via l'event `MessageCreate` mais on le persist dès maintenant pour
   feedback UI immédiat — l'event de Discord viendra confirmer plus tard,
   on dédup via `external_message_id`)

Note sur la dédup : si le worker reçoit un `MessageCreate` pour un message
dont `external_message_id` existe déjà en DB, il le skip. Évite la double
insertion via la double-source (API directe + gateway).

### Job BullMQ `historySync`

Au moment où une session Discord est créée (callback OAuth), on enqueue
un job `historySync` qui :
1. Récupère la liste des channels du guild
2. Pour chaque channel, fetch les 100 derniers messages (paginé curseur
   `before=`)
3. Insert chaque message dans `messaging_messages` (sur conflit `external_message_id`,
   skip = idempotent)
4. Publie un event `bridge:event:discord` `{ kind: 'history:synced', channelId,
   count }` à la fin de chaque channel pour que l'UI rafraîchisse

Worker dédié `history-sync-worker.ts` ? Ou le worker `discord-bridge`
peut héberger les jobs `historySync` aussi. Je propose de garder le bridge
worker focalisé sur la gateway et créer un worker BullMQ séparé
`packages/backend/src/workers/history-sync.ts` qui consomme la queue
`history-sync` — process distinct, restart isolé.

### Tests J3b

Les tests unit du provider sont limités (la lib discord.js est mockable
mais lourd à mock). On privilégie :
- **Mapper test** : `mapDiscordEvent` avec fixtures de payloads Discord
  réels → vérifie le format `ProviderEvent` produit
- **OAuth test** : signature/vérif state, callback avec state expiré → 400,
  state mismatch groupId → 403
- **Send message integration** : mock de `client.channels.fetch().send()`,
  vérifie que `messaging_messages` contient l'entrée + dédup OK

E2E manuel : on documente le scénario dans
`.agent/skills/integrate-messaging-platform.md` pour reproduction.

### Critère de validation J3b

- Manu peut configurer son `.env` avec un bot Discord de test
- `pnpm dev:worker:discord` démarre le worker, se connecte au gateway
- Manu peut ouvrir une URL d'install dans son navigateur (sans web app
  encore : on test direct via curl + ouverture manuelle de l'URL Discord)
- Le bot rejoint un serveur de test
- En envoyant un message dans un channel, le worker log "MessageCreate
  received" et publie sur Redis (vérifiable via `redis-cli MONITOR`)

---

## J3c — Propagation events + WebSocket (2-3 j)

### Backend abonné à Redis pub/sub

Au démarrage du backend HTTP, après `buildServer()` :
- S'abonne à `bridge:event:*` (pattern subscribe Redis)
- Pour chaque event reçu :
  - Resolve `sessionId` → `groupId` (lookup table sessions)
  - Resolve `groupId` → liste des userIds membres
  - Pour chaque userId connecté en WS : `connectionStore.send(userId, wsEvent)`

### WS events ajoutés à `@nexus/shared/ws-protocol.ts`

```ts
export const WsEventSchema = z.discriminatedUnion('type', [
  // existants
  z.object({ type: z.literal('presence:update'), payload: PresencePayload, timestamp: z.string() }),
  // nouveaux J3c
  z.object({ type: z.literal('message:new'), payload: MessagePayload, timestamp: z.string() }),
  z.object({ type: z.literal('message:edit'), payload: MessagePayload, timestamp: z.string() }),
  z.object({ type: z.literal('message:delete'), payload: MessageDeletePayload, timestamp: z.string() }),
  z.object({ type: z.literal('message:reaction'), payload: ReactionPayload, timestamp: z.string() }),
  z.object({ type: z.literal('history:synced'), payload: HistorySyncedPayload, timestamp: z.string() }),
]);
```

Le `groupId` figure dans tous les payloads pour permettre au client de
filtrer côté front (ex. dispatcher dans le bon écran).

### Filtrage par membership

Le `connection-store` (J1e) a déjà la map `userId → ws`. On enrichit avec
la map `userId → groupIds` peuplée à l'authentification WS (déjà dans le
JWT).

Pour l'event filtering :
```ts
function broadcastToGroup(groupId: string, event: WsEvent) {
  const userIds = membershipCache.getMembers(groupId);  // lookup en cache
  for (const uid of userIds) {
    const conns = store.getByUserId(uid);
    for (const ws of conns) ws.send(JSON.stringify(event));
  }
}
```

`membershipCache` : Redis-backed cache avec TTL 5 min, invalidé sur les
events `member:added`/`member:removed` (futurs J5+). Pour J3c, on peut
faire le lookup direct DB à chaque event — mesurer la perf, optimiser
si nécessaire.

### Tests J3c

**Integration** (`event-bus-propagation.test.ts`) :
- Spawn un mock publisher qui balance un event sur `bridge:event:discord`
- Le backend (avec un user authentifié + WS connecté) reçoit l'event WS
- Vérifie le format du payload côté client

**Anti-leak** :
- User A + groupe G1, User B + groupe G2
- Event publié pour la session du G1
- User A reçoit l'event WS, User B ne reçoit RIEN

### Critère de validation J3c

- Tests d'intégration passent
- E2E manuel : ouvrir 2 onglets navigateur connectés au WS Nexus,
  envoyer un message dans Discord, les 2 onglets l'affichent (via
  `console.log(event)` car pas d'UI encore)

---

## J3d — Tests + stabilisation + récap (2 j)

### Couverture cible

| Module                              | Type           | Cible       |
|-------------------------------------|----------------|-------------|
| `core/encryption.ts`                | Unit           | 100%        |
| `core/session-store.ts`             | Integration    | 90%         |
| `core/event-bus.ts`                 | Integration    | 80%         |
| `discord/oauth.ts`                  | Unit           | 100%        |
| `discord/mapper.ts`                 | Unit + fixture | 95%         |
| `csrf-protection.ts`                | Integration    | 100%        |
| Endpoints `/messaging/*`            | Integration    | 80%         |

### CI

Le workflow `ci.yml` doit déjà tourner avec Postgres + Redis. Vérifier
que les nouveaux tests passent. Pas de modif workflow nécessaire pour J3
(ADR-011/012 sont implémentés en J3.5 séparément).

### Documentation

- Mise à jour `.agent/skills/integrate-messaging-platform.md` avec le
  flow Discord exact (URL, scopes, redirect URI, troubleshooting commun)
- Mise à jour `.agent/skills/add-websocket-event.md` avec un exemple
  `message:new`
- Nouveau skill `.agent/skills/use-auth-web.md` (J3.0)
- README dans `packages/backend/src/integrations/` qui décrit
  l'architecture pour le prochain dev qui ajoutera WhatsApp/Messenger

### Récap final J3

À écrire dans `.agent/current-task.md` à la fin de J3.

---

## Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|-----------|
| Les privileged intents Discord (Message Content) demandent une review au-delà de 100 servers — pas un bloquant pour MVP | J3b post-launch | Documenter clairement, prévoir la review process dès la beta privée |
| Le bot Discord peut être retiré d'un serveur sans qu'on le sache | J3b | Listener `Events.GuildDelete` → marque la session `error` avec reason `bot_kicked` |
| Le worker singleton est un SPOF | J3b | Pour MVP : restart automatique via Docker `restart: unless-stopped`. Plus tard : multi-instance avec leader election |
| `ENCRYPTION_KEY_BRIDGES` perdue = sessions illisibles | J3a | Backup explicite de cette clé dans un coffre séparé (pas dans les backups DB qui contiennent les ciphertexts), procédure documentée |
| Redis pub/sub n'est pas durable (events perdus si subscriber down) | J3c | Acceptable pour event live (le client se reconnecte et fait un fetch). Pour le persistence, les messages sont déjà en DB via worker. |
| `discord.js` peut breaker à un upgrade majeur | J3b | Pin de version, `pnpm-lock` commité, upgrade explicit |

## Dépendances ajoutées

```json
// packages/backend/package.json
{
  "dependencies": {
    "@fastify/cookie": "^11.0.0",          // J3.0
    "discord.js": "^14.16.0",               // J3b
    "bullmq": "^5.20.0"                    // J3a (préparé) + J3b (history-sync)
  }
}
```

`ioredis` est déjà installé depuis J1. `bullmq` peut être ajouté en J3a
même si pas utilisé tout de suite.

## Variables d'env J3 (récap)

Ajoutées au `.env.example` :
```
# J3a — Bridges encryption
ENCRYPTION_KEY_BRIDGES=  # base64 32 bytes — généré via openssl rand -base64 32

# J3b — Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_PERMISSIONS=274877975552  # bitfield à calculer (read msgs + send + history)

# J3b — OAuth callback
PUBLIC_BASE_URL=http://localhost:3000  # https://api.nexusapp.chat en prod
```

## Checklist de validation avant démarrage

- [ ] Manu valide ce plan en bloc OU commente section par section
- [ ] Manu confirme que `ENCRYPTION_KEY_BRIDGES` sera générée et sauvée
      en lieu sûr (1Password, KeePass, ou autre coffre — pas dans le repo)
- [ ] Manu crée l'application Discord developer + bot + récupère token/IDs
      (à faire avant J3b — peut être fait pendant que J3.0 + J3a sont en cours)
- [ ] Manu valide la décision "1 worker singleton pour Discord" (cf. J3b)
- [ ] Manu valide l'arbo `packages/backend/src/integrations/`
- [ ] Manu valide le découpage 5 sous-jalons et l'ordre α (J3.0 → J3a → J3b → J3c → J3d)
- [ ] Manu valide l'estimation 1.5-2 sem total

## Sortie de J3

À la fin :
- Backend supporte auth en mode web (cookies + CSRF)
- Architecture bridges en place et documentée
- Discord branché : send et receive fonctionnent
- Events Discord propagés sur le WS Nexus
- Tests + skills + ADR à jour
- Prêt à attaquer J3.5 (CI/CD + premier deploy prod) puis J4-pre + J4
