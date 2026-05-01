# Roadmap Nexus — MVP et au-delà

**Statut global** : Proposé, en attente de validation Manu.
**Dernière mise à jour** : 2026-04-30 (rév. 3 : bascule sur bridges server-side
suite aux exigences envoi/parité mobile/killer features).

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

## Jalon 4 — Desktop shell Tauri + login + écran conversations (≈ 1.5 semaine)

**But** : première app desktop fonctionnelle.

Livrables :
- App Tauri minimale (`packages/desktop`)
- React + Tailwind + shadcn/ui setup
- Zustand store pour auth + groupe courant
- TanStack Query pour le data fetching
- Écrans : login, liste groupes, conversation Discord branchée, envoi de message
- Reconnexion WebSocket automatique (`reconnecting-websocket`)
- Notifications natives Tauri à la réception d'un message hors-fenêtre
- Custom URL scheme `nexus://` enregistré pour deep links (cf. ADR-010)

**Critère de validation** : Manu installe Nexus desktop, se logge, voit ses
conversations Discord, peut répondre.

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
