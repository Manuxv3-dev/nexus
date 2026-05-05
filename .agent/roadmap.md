# Roadmap Nexus — MVP et au-delà

**Statut global** : J0 → J5b livrés + ADR-027 (universalisation webview
messaging) + ADR-028 (sessions user-scoped). Polish post-ADR-027 livré
session 2026-05-04. Reste : V1.2 notifs transverses producteurs, push
GitHub commits accumulés, démarrage J6 (intent detection Claude) ou J9
(déploiement V1).

**Dernière mise à jour** : 2026-05-04.

> ⚠️ **Doc obsolète à actualiser** : ce fichier décrit encore les jalons J3
> (bridges Discord server-side), J7 (WhatsApp Baileys), J8 (Messenger
> mautrix-meta + Conduit) tels que pensés à l'origine. Ces jalons sont
> entièrement **OBSOLÈTES** depuis **ADR-027** (universalisation webview
> messaging) : plus de workers bridge, plus de pub/sub Redis bridge, plus
> de stack Matrix. Toutes les 12 messageries (Discord, WhatsApp, Messenger,
> Telegram, Instagram, Slack, Teams, LinkedIn, X, Reddit, TikTok, Snapchat)
> sont encapsulées en webview Tauri côté desktop, placeholder + window.open
> côté web pur. Conséquence : J3 (bridges) + J7 + J8 ont été remplacés par
> ADR-027 livré. Le critère de validation J9 (Discord + WhatsApp +
> Messenger en prod via bridges) a été repensé : c'est désormais
> "12 providers en webview encapsulée tournent en Tauri desktop".
>
> **Refactor roadmap à faire** : reprendre ce fichier pour refléter
> l'état réel post-ADR-027 + supprimer les jalons obsolètes (J3 bridges,
> J3.5 CI worker discord, J7, J8) + intégrer le polish déjà livré.
> Tracé dans backlog comme dette doc 🟢.

## Principes de découpage

- Chaque jalon est livrable et démontrable indépendamment.
- On valide le moteur de coordination dès qu'**une** messagerie est branchée
  (Discord) — c'est le cœur de la valeur Nexus.
- L'architecture multi-tenant-ready et le typage end-to-end sont posés dès J0-J1.
- **Toutes les messageries** sont intégrées via **bridges server-side** (cf. ADR-009)
  pour garantir parité desktop/mobile et l'envoi depuis Nexus.
- **Pas d'auto-envoi dans les conversations source** : les killer features
  exposent des **liens Nexus publics** que l'utilisateur partage manuellement
  (cf. ADR-010).
- Le mobile arrive en V2 mais l'API et l'archi sont compatibles dès J3 — la V2
  consomme les mêmes endpoints, sans refactor backend.

## Jalon 0 — Fondations (≈ 2-3 jours dev)

**But** : repo propre, CI verte, environnement local reproductible.

Livrables :
- Monorepo pnpm + Turborepo opérationnel (`pnpm i && pnpm typecheck` passe)
- TypeScript strict partout, tsconfig partagé
- ESLint + Prettier alignés
- Vitest configuré pour `@nexus/backend` et `@nexus/shared`
- Docker Compose dev : PostgreSQL 16, Redis 7
- GitHub Actions : `lint`, `typecheck`, `test`, `build` sur PR
- README racine avec setup
- Conventional Commits + commitlint (recommandé)

**Critère de validation** : un nouveau dev clone, `pnpm i`, lance Compose, et
peut faire tourner les tests et le typecheck en moins de 5 minutes.

## Jalon 1 — Backend kernel (≈ 1 semaine)

**But** : un Fastify minimal, typé, observable, avec auth fonctionnelle.

Livrables :
- Fastify 4+ avec plugins core
- Drizzle ORM + drizzle-kit, migrations versionnées, premier schéma
  (`users`, `groups`, `group_members`, `refresh_tokens`)
- Pino logger structuré, request-id, niveaux par env
- Validation Zod en entrée/sortie d'API
- Endpoints auth : `register`, `login`, `refresh`, `logout`, `logout-all`, `me`
- Erreurs typées (codes `AUTH_INVALID_CREDENTIALS`, `VALIDATION_ERROR`, etc.)
- Squelette WebSocket : connexion authentifiée par JWT, ping/pong
- Tests d'intégration (Vitest + supertest, base PostgreSQL test isolée par run)

**Critère de validation** : un client peut s'inscrire, se connecter, ouvrir
une WS, recevoir un `presence:update` quand un autre user du même groupe se
connecte.

## Jalon 2 — Domaine "groupes" et squelette d'orga (≈ 3-4 jours) — ✅ LIVRÉ

**But** : modèle métier groupe + permissions de base.

Livrables :
- ✅ Schéma `group_invitations` + migration `0001_add_group_invitations.sql`
- ✅ Service groupes (CRUD + invitations transactionnelles avec FOR UPDATE)
- ✅ Slug generator base62 (12 chars, ~62^12 entropie)
- ✅ Middleware `requireGroupMembership` (anti-leak : 404 si non-membre)
- ✅ Helpers `getGroupContext` + `requireGroupRole` (hiérarchie owner > admin > member)
- ✅ 11 endpoints : CRUD groupes (5), membres (2), invitations (4)
- ✅ Tests d'intégration (23 cas) couvrant CRUD, anti-leak cross-group,
  permissions par rôle, idempotence accept, max_uses, révocation
- ✅ Anti-leak DB-side via `findInvitationInGroup(groupId, invitationId)`

**Critère de validation atteint** : un user A créant un groupe G1 + un user B
créant un groupe G2 ne peuvent ni se voir mutuellement, ni manipuler les
invitations de l'autre. Tous les non-membres reçoivent 404 (pas 403).

## Jalon 3 — Architecture bridges + Discord (≈ 1.5-2 semaines)

**But** : poser l'architecture commune des bridges (cf. ADR-009) et brancher
Discord comme première implémentation.

Livrables — partie commune (architecture bridges) :
- Interface `MessagingProvider` dans `@nexus/shared`
- Table `messaging_provider_sessions` avec stockage chiffré AES-GCM
- Module `@nexus/backend/integrations/core/` (session-store, encryption,
  bridge-registry, event-bus)
- Pattern worker BullMQ : process séparé, lock Redis pour stickiness session,
  reconnexion sur restart
- Healthcheck + monitoring de base (gauge, counters, lag_ms)
- Pub/sub Redis pour propagation events bridges → backend API → WS clients

Livrables — Discord :
- Implémentation `DiscordProvider` via discord.js v14
- Bot register flow (OAuth Discord pour invitation au serveur)
- Worker `discord-bridge` (process séparé)
- Mapping `messaging_channels`
- Sync historique paginé (worker BullMQ idempotent)
- WS events `message:new`, `message:edit`, `message:delete` propagés
- Endpoint `GET /groups/:id/messages?cursor=`

**Critère de validation** : un message envoyé dans Discord apparaît dans le
WS Nexus en moins de 2s ; un message envoyé via API Nexus arrive dans
Discord. Le worker peut être restarté sans perdre la connexion gateway.


À noter — sous-jalon transverse intégré à J3 :
- **J3.0** (1-2 j) — **Auth web mode cookie** (cf. ADR-015) : ajout du
  plugin CSRF + support `X-Nexus-Client: web` sur les endpoints auth, pour
  que la web app soit prête à consommer.

## Jalon 3.5 — CI/CD + premier deploy VPS prod (≈ 2-3 jours) — NOUVEAU

**But** : pouvoir déployer le backend en prod à chaque merge sur `main`,
avant même que le client web soit prêt.

Cf. ADR-011, ADR-012, ADR-013.

Livrables :
- Dockerfile multi-stage backend (`packages/backend/Dockerfile`)
- Workflow `.github/workflows/deploy.yml` (build → GHCR → SSH → docker compose pull)
- Setup VPS Hostinger : Docker, user `nexus-deploy`, firewall, dossier `/opt/nexus/`
- `infra/Caddyfile` (`nexusapp.chat` + `app.` + `api.`)
- `infra/docker-compose.prod.yml` (Caddy + backend + Postgres + Redis)
- `infra/deploy.sh` : orchestration migration DB → swap container → healthcheck → rollback si KO
- Secrets GitHub : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`
- Secrets VPS : `/opt/nexus/.env.production` + Postgres credentials Docker secrets
- Cron backup Postgres quotidien (`pg_dump` → `/var/backups/nexus/`)
- Doc opérateur `infra/README.md` + `infra/restore.md`

**Critère de validation** : Manu push sur `main` → CI verte → 2-3 minutes
plus tard, `https://api.nexusapp.chat/api/v1/health` répond avec la nouvelle
version. Rollback testé : `docker compose up -d backend` avec un tag SHA
précédent fait revenir l'ancienne version en < 30 s.

## Jalon 4-pre — Landing teasing + waitlist (≈ 2 jours) — NOUVEAU

**But** : avoir une présence publique sur `nexusapp.chat` pendant que
l'app web est en construction. Capturer des emails pour la beta privée.

Livrables :
- `packages/landing/` (Astro ou Vite static, selon arbitrage léger en démarrage J4-pre)
- Design : moderne, animé (Framer Motion), dark mode, responsive
- Sections : hero (le problème + la promesse), features key (intégration messageries +
  killer features), waitlist email capture
- Backend endpoint `POST /api/v1/waitlist` (email + source) — table `waitlist`
  toute simple
- Déploiement via le pipeline ADR-011 (sert les statics depuis Caddy via
  `/srv/landing` mounted volume)
- Open Graph card complète (image générée Satori ou statique)

**Critère de validation** : `https://nexusapp.chat` est en ligne, esthétique,
mobile-friendly, capture les emails dans la base Nexus.

## Jalon 4 — Web app + Tauri wrapper + PWA (≈ 2-3 semaines) — REMANIÉ

**But** : première version utilisable de Nexus, accessible directement via
navigateur (web app) et installable comme PWA. Wrapper Tauri optionnel
pour ajouter les capacités natives desktop.

Cf. ADR-014.

Sous-jalons :

**J4a** (3-4 j) — Scaffolding `@nexus/web` + couche `platform`
- `packages/web/` (Vite + React 19 + TS + Tailwind + shadcn/ui + TanStack Query + Zustand)
- `packages/platform/` (interfaces TypeScript : NotificationProvider, SecureStorageProvider, etc.)
- `packages/platform-web/` (impls Web APIs)
- Routing (TanStack Router ou React Router) + structure dossiers
- Layout root + login screen connecté à l'API (mode cookie web ADR-015)

**J4b** (5-6 j) — Écrans principaux
- Liste groupes (créer, rejoindre via invitation, switcher)
- Liste membres / paramètres groupe
- Écran conversation Discord (consomme J3)
- Envoi de message
- Reconnexion WebSocket automatique
- Multi-tabs propre (BroadcastChannel pour le refresh auth)

**J4c** (3-4 j) — PWA
- `manifest.webmanifest` (icônes, theme, display standalone)
- Service worker via `vite-plugin-pwa` (cache UI shell, offline read-only)
- Web Push API + VAPID server-side (endpoint subscription, push à la
  réception d'un message hors-fenêtre)
- Install prompt smart (afficher après une session active)

**J4d** (5-7 j) — Wrapper desktop Tauri (optionnel selon priorité ressentie)
- `packages/desktop/` (Tauri 2 chargeant `packages/web/dist`)
- `packages/platform-tauri/` (Tauri APIs)
- Notifications natives, démarrage auto, deep links `nexus://`

**Critère de validation** : Manu se logge depuis Chrome sur `https://app.nexusapp.chat`,
voit ses conversations Discord, envoie un message, reçoit une notif Web Push
quand quelqu'un répond. La même app peut être installée comme PWA sur
Android / iOS / desktop.

(Bascule `nexusapp.chat` de la landing vers l'app : voir J9 launch.)

## Jalon 5 — Couche d'organisation + pages publiques (≈ 2.5 semaines)

**But** : la valeur ajoutée Nexus — agenda, sondages, dépenses, todos —
ET les pages publiques permettant le partage cross-messagerie via lien.

Livrables (chaque module est un sous-jalon de ~3 jours) :
- 5a. **Page publique générique** : routes `/e/:slug`, `/p/:slug`, `/d/:slug`,
  `/t/:slug`, `/l/:slug`. Slug base62. Open Graph cards (cf. ADR-010).
  Page `og:image` générée dynamiquement (Satori ou @vercel/og).
- 5b. **Événements** : CRUD + RSVP + rappels (worker BullMQ scheduling) +
  page publique `/e/:slug`
- 5c. **Sondages** : CRUD + vote + clôture + résultats + page publique `/p/:slug`
- 5d. **Dépenses** : ajout, répartition, calcul des soldes (algo style
  Tricount), marquage règlement + page publique `/d/:slug`
- 5e. **Todos / listes** : CRUD + assignation + statut + page publique `/t/:slug` `/l/:slug`

Pour chaque module métier :
- Tables Drizzle dédiées (avec champ `slug`)
- Endpoints REST `/groups/:id/<module>/...`
- WS events typés
- Écrans desktop dédiés
- "Copier le lien" toujours visible
- Route publique correspondante

**Critère de validation** : la bande d'amis utilise l'app pour organiser un
weekend. Manu crée un événement, partage le lien dans Messenger, ses amis
cliquent et RSVP, tout ce flux passe sans qu'aucun message ne soit
auto-posté par Nexus dans Messenger.

## Jalon 6 — Détecteur d'intention Claude + actions inline (≈ 1 semaine)

**But** : la couche IA qui transforme Nexus en agrégateur intelligent.

Livrables :
- Service `IntentDetector` (cf. skill `use-claude-api.md`)
- Hook côté ingestion message : analyse Claude par message texte
- Schéma Zod `{ intent, confidence, payload }` strict
- Action inline côté desktop : suggestion dans la conversation Nexus
  (ex: "Créer un événement 'Soirée samedi 20h' ?" + bouton)
- Cache des analyses (clé déterministe par contenu)
- Quotas par groupe (rate-limit + budget mensuel max)
- **Strict** : la suggestion produit une **action Nexus** (création
  d'événement/sondage/etc.) et **n'envoie jamais** de message dans la
  conversation source (cf. ADR-010)

**Critère de validation** : un message *"On se voit samedi soir chez moi vers
20h ?"* déclenche dans Nexus une suggestion inline d'événement. Aucun
message n'est posté en retour dans la conversation source.

## Jalon 7 — Bridge WhatsApp via Baileys (≈ 1.5 semaine)

**But** : WhatsApp pleinement intégré, lecture + envoi.

Livrables :
- Implémentation `WhatsappProvider` via Baileys (`@whiskeysockets/baileys`)
- Worker `whatsapp-bridge` dédié (un process Node par session active)
- Flow QR code de pairing dans l'UI Nexus
- Stockage Signal protocol chiffré en DB
- Mapping `messaging_channels`
- Modal de consentement explicite (cf. ADR-008)
- Rate limiting sur les envois (~30 msg/min par session)
- Healthcheck + monitoring
- Politique de purge 30 j (paramétrable)

**Critère de validation** : Manu scanne le QR, voit ses conversations
WhatsApp, peut taper et envoyer un message depuis l'UI Nexus, le moteur
d'intention analyse les messages WA.

## Jalon 8 — Bridge Messenger via mautrix-meta + Conduit (≈ 2 semaines)

**But** : Messenger pleinement intégré, lecture + envoi. Plus risqué et plus
long que WhatsApp à cause de la stack Matrix.

Livrables :
- Conduit déployé en Docker sur le VPS (homeserver Matrix léger)
- mautrix-meta déployé en Docker (bridge), configuré comme Application
  Service de Conduit
- Implémentation `MessengerProvider` qui consomme l'Application Service API
  (events Matrix → ProviderEvent normalisé)
- Worker `messenger-bridge` dédié
- Login Meta via mautrix-meta (flow OAuth Meta ou login email/password selon
  ce que mautrix-meta supporte au moment de J8)
- Modal de consentement explicite (cf. ADR-007)
- Rate limiting sur les envois
- Healthcheck + monitoring
- Politique de purge 30 j

**Critère de validation** : Manu connecte Messenger, voit ses conversations,
peut taper et envoyer un message depuis l'UI Nexus.

## Jalon 9 — Stabilisation + déploiement V1 (≈ 1.5 semaine)

Livrables :
- Pipeline de release Tauri (auto-update via tauri-updater + bucket S3-compatible)
- Docker Compose prod : backend Nexus, PostgreSQL, Redis, Conduit, mautrix-meta,
  worker WhatsApp, worker Discord, worker Messenger, nginx, certbot
- Backend déployé sur VPS Hostinger upgradé (4-8 Go RAM)
- Monitoring minimal : pino → fichier + uptime check externe
- Smoke test prod quotidien : healthcheck de chaque bridge + alerte si KO > 5 min
- Documentation utilisateur basique (FAQ "Pourquoi un consentement WhatsApp ?", etc.)
- Audit "prêt-multi-tenant" (cf. ADR-005)
- Politique de privacy / consentement RGPD claire
- Procédure de migration des sessions chiffrées si rotation de clé

**Critère de validation** : Nexus V1 (Discord + WhatsApp + Messenger + couche
d'orga avec liens partagés + IA) tourne en prod, la bande l'utilise au
quotidien depuis 1 semaine sans incident bloquant.

---

## Au-delà du MVP

### V1.x — Stabilisation et UX
- Médias (photos, audios) sur Messenger/WhatsApp/Discord
- Recherche full-text dans les conversations bridgées
- Export d'un groupe vers JSON (RGPD)
- Mode hors-ligne basique côté desktop

### V2.0 — Mobile React Native (Expo)
**Aucun refactor backend nécessaire** — l'API REST/WebSocket est déjà
agnostique du client. Le mobile consomme exactement les mêmes endpoints que
le desktop.

Livrables :
- App React Native + Expo (`packages/mobile`)
- Réutilisation maximale de `@nexus/shared` (types, schemas Zod, logique métier)
- Universal Links iOS / App Links Android pour les liens Nexus partagés
- Notifications push (APNs / FCM via Expo Notifications)
- Parité fonctionnelle complète : Discord + WhatsApp + Messenger + couche d'orga + IA

### V2.x — Multi-tenant SaaS (cf. ADR-005)
Migration `users` / `oauth_connections` / `refresh_tokens` pour ajouter
`tenantId`. Pages publiques. Plans tarifaires. Onboarding self-service.

### V2.x — Médias et fonctionnalités riches
Support des médias dans tous les bridges, voix/audios, partage de fichiers,
réactions emoji.

## Risques et dépendances cross-jalons

| Risque                                        | Jalon impacté    | Mitigation                                                                |
|-----------------------------------------------|------------------|---------------------------------------------------------------------------|
| Meta change protocole Messenger/WhatsApp      | J7-J8 + post-MVP | Pin de version bridge, alerting fast-track, fallback documenté            |
| Quotas Claude API explosent                   | J6               | Cache + rate-limit dès le départ, budget visible                          |
| Discord change ses ToS bot                    | J3+              | Veille active, pattern provider isolé                                     |
| Ban WhatsApp/Messenger pour usage perçu abusif| J7-J8 + post-MVP | Rate-limit strict envoi, pas d'auto-post (ADR-010), consentement explicite |
| VPS sous-dimensionné                          | J9               | Inventaire actuel + plan d'upgrade validé avant J7                        |
| Conduit (homeserver) incompatible mautrix-meta| J8               | POC dès le début de J8, fallback Synapse (RAM doublée mais éprouvé)       |
| Mobile V2 retardé / impossible (App Store)    | V2               | Archi serveur déjà compatible — au pire on garde web responsive en attendant |
| RGPD : stockage messages bridgés              | J7-J8            | Politique de purge 30 j par défaut, opt-in archive long                   |
