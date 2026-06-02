# Roadmap Nexus — MVP et au-delà

**Dernière mise à jour** : 2026-06-02 (réécriture complète post-ADR-027 +
abandon du détecteur d'intention, cf. ADR-032).

## Statut global

**V1 publique LIVE.** Backend + landing + SPA web sur api/app/nexusapp.chat ;
desktop Tauri (Windows live, macOS + Linux dans le pipeline) sur GitHub
Releases avec auto-updater. Smoke-test prod 17/17 vert au 2026-06-02.

Ce qui est livré :

- **Fondations** : monorepo pnpm + Turborepo, TS strict, ESLint/Prettier,
  Vitest, Docker Compose dev, CI (lint/typecheck/test/build), Conventional
  Commits.
- **Backend kernel** : Fastify typé, Drizzle ORM (14 migrations), Pino,
  validation Zod in/out, erreurs typées, WebSocket authentifié JWT, auth
  JWT + refresh (+ mode cookie web, ADR-015).
- **Domaine groupes** : CRUD groupes, membres, invitations transactionnelles,
  anti-leak cross-group (404), rôles owner/admin/member.
- **Web app + shell desktop** : `@nexus/web` (React + TS + Tailwind +
  shadcn/ui + TanStack Query + Zustand), AppShell, login mode cookie,
  reconnexion WS auto ; shell Tauri 2 (ADR-026).
- **Couche d'organisation** (le cœur de valeur) : événements + RSVP +
  rappels (worker BullMQ), sondages + vote, dépenses + répartition + settle
  (algo type Tricount), todos/listes + assignation — chacun avec sa **page
  publique** partageable (`/e /p /d /t /l`, slugs base62, Open Graph cards,
  ADR-010 : jamais d'auto-post dans la messagerie source).
- **Notifications transverses V1.2** (ADR-023) : table persistée, cloche +
  panneau in-app, producteurs (rappels/RSVP/expenses/todos), WS
  `notification:created`, purge 30 j. **Préférences par kind** (ADR-034) :
  `user_notif_prefs` + `GET/PATCH /notifications/preferences`, respectées au
  choke point d'insertion (un kind off = ni notif ni push).
- **Gestion du compte** (ADR-033) : édition profil (nom/email), changement de
  mot de passe, suppression de compte RGPD (transfert d'ownership des groupes)
  — endpoints `/auth/me` + `/auth/change-password`, modales SettingsScreen.
- **Agrégation messageries en webview** (ADR-022 → ADR-027) : les 12
  messageries (Discord, WhatsApp, Messenger, Telegram, Instagram, Slack,
  Teams, LinkedIn, X, Reddit, TikTok, Snapchat) sont **encapsulées en webview
  Tauri** côté desktop (placeholder + `window.open` côté web pur). Sessions
  user-scoped (ADR-028). Cookies isolés par provider.
- **Pipeline release desktop** (ADR-031) : `desktop-release.yml`, signing
  updater Tauri, matrix Windows + macOS + Linux, banner front `UpdaterBanner`.
- **Infra prod** (ADR-011/012/013/030) : Docker multi-stage, GHCR, deploy.sh
  - healthcheck + rollback, Postgres 16 + Redis 7, workers BullMQ
    (reminders + purge), reverse-proxy Traefik existant + Caddy statics.

## Le produit, en une phrase

Un **agrégateur de messageries** (12 services en webview encapsulée) **+ une
couche d'organisation explicite** pour bandes d'amis (agenda/événements,
sondages, dépenses partagées, todos), avec partage cross-app par **liens
publics**. Pas de bridge serveur, pas de lecture des messages, pas d'IA.

## Décisions structurantes qui ont fait pivoter la roadmap initiale

- **ADR-022 → ADR-027 (encapsulation webview)** : abandon total de
  l'architecture « bridges server-side » (workers discord.js / Baileys /
  mautrix-meta + Conduit + pub/sub Redis bridge + stockage messages chiffrés).
  On n'héberge plus de stack Matrix, on ne lit plus les messages. Raisons :
  conformité ToS Meta/WhatsApp, RGPD, coût d'hébergement, fragilité. → Les
  jalons historiques « J3 bridges Discord », « J7 WhatsApp Baileys », « J8
  Messenger mautrix » sont **supprimés**.
- **ADR-032 (abandon du détecteur d'intention)** : sans lecture des messages,
  l'« intent detection » IA (ex-Jalon 6) n'a plus de surface. Feature
  **abandonnée**. L'API Claude n'est plus une dépendance produit.

## Prochaines étapes (priorisées)

### Court terme — polish desktop & navigation

- **Lot UX desktop/webview** : webviews persistantes (pas de reload à chaque
  bascule provider), bypass landing en mode Tauri (boot direct `/login`),
  contrôles fenêtre flottants en surimpression de la webview.
- **Navigation Home/Groupe** : indicateur « Home Nexus » actif (cadre léger vs
  fond bleu), clic icône de groupe → home de groupe dédiée, activité récente
  cross-feature.
- **Validation desktop** : vérif manuelle Windows (login, WS, webviews
  providers, banner updater) + premier tag `desktop-v*` buildant les 4 cibles.

### Moyen terme — durcissement & qualité

- **Durcissement Traefik** (cf. `.agent/notes/traefik-existing.md`) :
  désactiver `--api.insecure`, basic-auth dashboard, vrai email LE, access
  logs + rotation, figer l'image Traefik.
- **Audit firewall UFW** du VPS, cohabitation n8n.
- **Densification des dashboards** Home Nexus + GroupHome.
- **Externalisation design pro** avant push marketing public (option à arbitrer).

### Plus tard / si feedback réel

- **Code-signing Windows EV** (si SmartScreen bloque trop) ; **cert Apple**
  (si Gatekeeper gêne sur macOS).
- **Microsoft Store** (assets MSIX).

## Au-delà du MVP

### V1.x — Stabilisation et UX

- Réordonnancement des providers dans le volet conversations.
- Export d'un groupe vers JSON (RGPD + sauvegarde perso).
- Mode « vacances » : tableau de bord d'un voyage groupe (events + dépenses +
  todos agrégés).
- i18n (démarrage FR, archi prête pour d'autres langues).

### V2.0 — Mobile React Native (Expo)

**Aucun refactor backend nécessaire** — l'API REST/WebSocket est agnostique du
client. Le mobile consomme les mêmes endpoints.

- App React Native + Expo (`packages/mobile`), réutilisation maximale de
  `@nexus/shared`.
- Universal Links iOS / App Links Android pour les liens Nexus partagés.
- Notifications push (APNs / FCM via Expo Notifications).
- ⚠️ La partie webview-messageries devra être repensée sur mobile (les pages
  web officielles ne sont pas toutes pensées pour un webview mobile encapsulé)
  — à arbitrer en ADR au démarrage de la V2.

### V2.x — Multi-tenant SaaS (cf. ADR-005)

Ajout `tenantId` sur `users` / `refresh_tokens` / tables métier, plans
tarifaires, onboarding self-service.

## Risques et dépendances

| Risque                                               | Impact     | Mitigation                                                               |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| Une messagerie casse / bloque sa page web en webview | Agrégation | Pattern provider isolé (1 webview = 1 module) ; dégradation par provider |
| Meta/services durcissent l'usage en webview tiers    | Agrégation | On reste sur les pages web **officielles**, pas d'injection/scraping     |
| SmartScreen / Gatekeeper bloquent l'install desktop  | Adoption   | Warnings documentés (ADR-031) ; signing EV/Apple si feedback réel        |
| VPS sous-dimensionné                                 | Prod       | KVM2 Hostinger largement dimensionné (2 vCPU / 8 Go) ; monitoring        |
| Mobile V2 webview-messageries impossible             | V2         | Couche d'orga reste 100 % portable ; arbitrage ADR au démarrage V2       |
