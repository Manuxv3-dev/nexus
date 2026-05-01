# Tâche en cours

**Statut** : ✅ ADR-011 à 015 validés. Prêt à attaquer **J3 — Architecture bridges + Discord**.

## ADR récemment actés (2026-05-01)

| ID  | Titre                                                                | Statut   |
|-----|----------------------------------------------------------------------|----------|
| 011 | Pipeline CI/CD — GitHub Actions → GHCR → VPS via SSH                 | Accepté  |
| 012 | Topologie VPS prod — Caddy + backend + workers + Postgres + Redis   | Accepté  |
| 013 | Migrations DB en prod — pattern expand/contract                      | Accepté  |
| 014 | Web app prioritaire — restructuration monorepo + couche `platform`   | Accepté  |
| 015 | Auth web — refresh token httpOnly cookie + CSRF token                | Accepté  |

Roadmap rév.4 : J3.5 (CI/CD VPS) et J4-pre (landing teasing) intercalés.
J4 remanié pour web app + PWA + Tauri wrapper optionnel.

## Prochaine étape — J3 (Architecture bridges + Discord, ≈ 1.5-2 sem)

Avant de coder, rédiger un **plan technique détaillé J3** (équivalent du
plan J1 qu'on avait fait), parce que c'est le morceau le plus structurant
du MVP. Découpage prévisionnel :

- **J3.0** (1-2 j) — **Auth web mode cookie** (cf. ADR-015)
  - Plugin Fastify `csrf-protection.ts` (double-submit cookie, validation header)
  - Modif endpoints auth : détection `X-Nexus-Client: web` → pose des cookies
    `nexus_refresh` (httpOnly) + `nexus_csrf` (lisible JS) au login/register
  - `/auth/refresh` accepte les deux modes (body-token natif vs cookie web)
  - `/auth/logout` supprime les cookies si mode web
  - Code d'erreur `AUTH_CSRF_MISMATCH` (403)
  - Tests d'intégration : mode native (existants) + mode web (nouveaux)
  - Skill `.agent/skills/use-auth-web.md`

- **J3a** — Architecture commune des bridges (cf. ADR-009)
  - Interface `MessagingProvider` dans `@nexus/shared` (méthodes : connect,
    disconnect, sendMessage, fetchHistory, subscribe, capabilities)
  - Schéma DB : table `messaging_provider_sessions` (groupId, providerType,
    encryptedCredentials AES-GCM, status, lastConnectedAt, lastError)
  - Module `@nexus/backend/integrations/core/`
    - `session-store.ts` (CRUD sessions chiffrées)
    - `encryption.ts` (AES-256-GCM avec ENCRYPTION_KEY_BRIDGES)
    - `bridge-registry.ts` (factory map providerType → ProviderClass)
    - `event-bus.ts` (Redis pub/sub : worker → backend → WS)
  - Pattern worker BullMQ
    - Process séparé (`packages/backend/src/workers/bridge-worker.ts`)
    - Lock Redis pour stickiness session (un seul worker par session active)
    - Reconnect on restart : reload sessions au boot
  - Healthcheck par session (gauge connected/disconnected, lag_ms, errors counter)

- **J3b** — Implémentation Discord
  - `DiscordProvider` via discord.js v14
  - Bot register flow : OAuth Discord pour invitation au serveur (générer
    URL d'invitation avec scopes bot + applications.commands)
  - Worker `discord-bridge` qui lance le client discord.js
  - Mapping `messaging_channels` (groupId Nexus, providerSessionId,
    externalChannelId Discord, name, type)
  - Sync historique paginé (BullMQ idempotent : `historySync` job avec curseur)
  - Endpoint `GET /api/v1/groups/:groupId/messages?cursor=&channelId=`

- **J3c** — Propagation événements
  - Pub/sub Redis : worker publie `bridge:message:new` → backend abonné
    relaie sur le WS
  - WS events typés via `@nexus/shared` : `message:new`, `message:edit`,
    `message:delete`, `message:reaction`
  - Filtrage côté backend : un user reçoit les events des channels dont son
    groupe a au moins une session active

- **J3d** — Tests + stabilisation
  - Tests unitaires de l'encryption + session-store
  - Tests d'intégration de l'event bus (mock Discord)
  - Test E2E manuel : connecter un serveur Discord de test, envoyer un
    message, vérifier qu'il arrive sur le WS Nexus en < 2s

## Pré-requis avant J3

- [ ] Tu valides en Accepté les ADR-011 à 015 ✅ (fait, 2026-05-01)
- [ ] Tu commit + push J2 (cf. récap J2g) si pas déjà fait
- [ ] Tu m'indiques si tu veux qu'on attaque J3 par J3.0 (auth web) ou par
  J3a (architecture bridges) en premier — l'ordre n'a pas de dépendance dure,
  c'est juste une question de quoi tu veux voir avancer en priorité

## Action attendue côté Manu

Push J2 + ADR-011..015 sur GitHub :

```bash
cd C:\Users\Manu\claude\nexus\nexus
git add .agent/ packages/backend
git commit -m "feat(backend): J2 domaine groupes + docs(adr): ADR-011..015 web-first

J2 — Domaine groupes :
- migration 0001 group_invitations
- service groupes + slug-generator base62
- middleware requireGroupMembership + helpers requireGroupRole / getGroupContext
- 11 endpoints REST /api/v1/groups[*] et /api/v1/invitations/:slug/accept
- 23 tests d'intégration (auto-skip sans Postgres)

ADR :
- ADR-011 pipeline CI/CD GitHub Actions → GHCR → VPS
- ADR-012 topologie VPS prod (Caddy + backend + Postgres + Redis)
- ADR-013 migrations DB en prod, pattern expand/contract
- ADR-014 web app prioritaire + couche platform
- ADR-015 auth web cookie httpOnly + CSRF

Roadmap rév.4 : J3.5 CI/CD, J4-pre landing teasing, J4 remanié web+PWA"
git push
```

## Blockers

Aucun.
