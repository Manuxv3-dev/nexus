# Tâche en cours

**Statut** : ✅ J3a (Architecture commune des bridges) livré. Prêt à attaquer **J3b — Discord provider + worker**.

## J3a — Architecture commune des bridges : livré

### Validations finales

- ✅ `pnpm typecheck` propre (3/3 packages)
- ✅ `pnpm lint` 0 errors (106 warnings préexistants ws code)
- ✅ `pnpm test` 28 unit (+ 14 nouveaux encryption) + 2 fichiers d'intégration skip Postgres
- ✅ Migration `0002_add_messaging_tables.sql` générée par drizzle-kit, journal MAJ

### Sous-jalons J3a livrés

| ID | Contenu |
|----|---------|
| J3a-1 | Interface `MessagingProvider` + types Zod (`ProviderType`, `ProviderCapabilities`, `ProviderMessage`, `ProviderChannel`, `ProviderStatus`) + events normalisés (`BridgeEvent` discriminated union) + `BridgeControl` (commandes API → worker) + helpers topics Redis dans `@nexus/shared/messaging/` |
| J3a-2 | 3 nouvelles tables Postgres : `messaging_provider_sessions` (avec colonne BYTEA `encrypted_credentials`), `messaging_channels`, `messaging_messages`. ENUMs `provider_type`, `provider_session_status`, `channel_type`. Index uniques anti-doublons. Migration 0002 générée + nommée |
| J3a-3 | Module `integrations/core/encryption.ts` AES-256-GCM (layout `IV(12) \|\| authTag(16) \|\| ciphertext`). 14 tests unit : round-trip ASCII/UTF-8/JSON/10KB/empty, IV random, corruption (authTag/ciphertext/IV), trop court, mauvaise clé, decryptJson invalid |
| J3a-4 | Module `integrations/core/session-store.ts` : CRUD wrapper avec chiffrement transparent (`encryptJson`/`decryptJson`), `findSessionInGroup` anti-leak, `updateSessionStatus` (mappe ProviderStatus → colonnes DB), `listAllSessions` pour worker boot |
| J3a-5 | `bridge-registry.ts` (factory map providerType → ProviderConstructor), `event-bus.ts` (Redis pub/sub publisher + subscriber sur `bridge:event:*` et `bridge:control:*`), `workers/lock.ts` (lock distribué Redis avec value unique + Lua scripts atomiques) |
| J3a-6 | `ENCRYPTION_KEY_BRIDGES` ajouté dans `core/env.ts` (Zod refine 32 bytes après base64-decode). `.env.example` MAJ avec section bridges détaillée. `integrations/README.md` documentant l'archi runtime, les topics Redis, les patterns de tests, le workflow d'ajout d'un provider |

### Fichiers ajoutés / modifiés (J3a)

```
packages/shared/src/
├── messaging/
│   ├── provider.ts                            [J3a-1] interface + types Zod
│   ├── events.ts                              [J3a-1] BridgeEvent + BridgeControl + topics
│   └── index.ts                               [J3a-1] re-exports
└── index.ts                                   [+ export './messaging/index.js']

packages/backend/
├── drizzle/migrations/
│   ├── 0002_add_messaging_tables.sql          [J3a-2] migration générée
│   └── meta/
│       ├── 0002_snapshot.json
│       └── _journal.json                      [tag renommé 0002_fancy_vulture → 0002_add_messaging_tables]
└── src/
    ├── core/env.ts                            [+ ENCRYPTION_KEY_BRIDGES Zod]
    ├── db/schema/index.ts                     [+ 3 tables + 3 enums + helper bytea custom type]
    ├── integrations/
    │   ├── README.md                          [J3a-6 doc opérateur]
    │   └── core/
    │       ├── encryption.ts                  [J3a-3 AES-256-GCM]
    │       ├── encryption.test.ts             [J3a-3 14 tests]
    │       ├── session-store.ts               [J3a-4 CRUD chiffré transparent]
    │       ├── bridge-registry.ts             [J3a-5 factory providerType]
    │       └── event-bus.ts                   [J3a-5 Redis pub/sub]
    └── workers/
        └── lock.ts                            [J3a-5 lock distribué Redis]

.env.example                                   [+ ENCRYPTION_KEY_BRIDGES + section Discord J3b prep]
```

### Points techniques notables

- **Anti-leak DB-side** : `(provider_type, external_id)` unique sur `messaging_provider_sessions` → impossible de rattacher un même serveur Discord à 2 groupes Nexus différents
- **Chiffrement authentifié** AES-256-GCM avec authTag de 16 bytes. Toute corruption (DB, transit) est détectée à la lecture
- **IV random à chaque chiffrement** : 96 bits de randomBytes → probabilité de collision négligeable, conforme à NIST SP 800-38D
- **Cache de la clé** chargée une seule fois par process (avec `resetEncryptionKeyCache` exposé pour les tests)
- **Lock distribué Redis** avec value unique (PID + ts + random) : releases/refreshes vérifient via Lua script atomique qu'on tient toujours le lock (évite les races)
- **Pub/sub topics typés** via Zod en sortie de pub ET en entrée de sub : aucun event mal formé ne traverse le bus
- **Cleanup propre** : `closeEventBus()` ferme tous les clients ioredis (publisher + subscribers events + control). À appeler en SIGTERM

## Prochaine étape — J3b (Discord provider + worker, ≈ 3-4 j)

Cf. plan détaillé `.agent/notes/j3-plan.md` (section J3b).

Préparation côté Manu requise avant que le code marche :
1. Créer une application Nexus sur https://discord.com/developers/applications
2. Onglet "Bot" : Add Bot, copier le token → `DISCORD_BOT_TOKEN` dans `.env`
3. Activer "Message Content Intent" et "Server Members Intent" (privileged)
4. Onglet "OAuth2" : copier Client ID + Client Secret
5. Ajouter le redirect URI : `http://127.0.0.1:3000/api/v1/messaging/discord/oauth/callback`

Découpage prévu :
- **J3b-1** (1 j) — `DiscordProvider` (discord.js v14) + mapper events Discord → ProviderEvent normalisés + tests mapper
- **J3b-2** (1 j) — OAuth bot install flow : signed state HMAC, callback, création session, publish control
- **J3b-3** (1 j) — Worker `discord-bridge.ts` (singleton, 1 process tous guilds) avec listeners gateway + control commands
- **J3b-4** (0.5 j) — Endpoints REST `/api/v1/groups/:groupId/messaging/*` (sessions, channels, messages send + history)

## Action attendue côté Manu

```bash
cd C:\Users\Manu\claude\nexus\nexus
git add .agent/ packages/backend packages/shared .env.example
git commit -m "feat(backend): J3a architecture commune des bridges (ADR-009)

- @nexus/shared/messaging : interface MessagingProvider + types Zod (ProviderCapabilities, ProviderMessage, ProviderChannel, ProviderStatus) + BridgeEvent/BridgeControl + helpers topics Redis
- migration 0002 : tables messaging_provider_sessions / channels / messages + 3 enums + colonne BYTEA encrypted_credentials
- integrations/core/encryption.ts : AES-256-GCM (layout iv||authTag||ciphertext) + 14 tests unit
- integrations/core/session-store.ts : CRUD chiffré transparent + anti-leak findSessionInGroup
- integrations/core/bridge-registry.ts : factory providerType → ProviderConstructor
- integrations/core/event-bus.ts : Redis pub/sub publish/subscribe avec validation Zod
- workers/lock.ts : lock distribué Redis (Lua scripts atomiques)
- env : ENCRYPTION_KEY_BRIDGES Zod-validé (base64 32 bytes)
- doc : packages/backend/src/integrations/README.md"
git push
```

## Blockers

Aucun. Avant J3b : créer l'application Discord developer (action manuelle de Manu).
