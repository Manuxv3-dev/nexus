# Nexus — guide développeur

Tout ce qui concerne l'architecture, la stack, l'installation et les
conventions de développement. Pour une présentation du produit, voir le
[README](../README.md).

## Sommaire

- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Setup](#setup)
- [Scripts utiles](#scripts-utiles)
- [Tests](#tests)
- [Conventions](#conventions)
- [Choix structurants (ADR)](#choix-structurants-adr)
- [Roadmap](#roadmap)

## Architecture

```
nexus/
├── .agent/                        # Mémoire vivante du projet (ADR, skills, roadmap)
│   ├── adr/                       # Architecture Decision Records
│   ├── skills/                    # Procédures et patterns réutilisables
│   └── …
├── docker-compose.dev.yml         # PostgreSQL 16 + Redis 7 pour le dev
├── scripts/dev-start.bat          # Lanceur complet stack (compose + workers + tauri)
└── packages/
    ├── backend/                   # @nexus/backend — API Fastify (sessions + killer features), workers BullMQ
    ├── web/                       # @nexus/web — React/Vite, frontend universel (web + shell desktop)
    ├── desktop/                   # @nexus/desktop — Shell Tauri 2 (webviews encapsulées des 12 messageries)
    ├── shared/                    # @nexus/shared — types, schémas Zod, contrats WS
    ├── platform/                  # @nexus/platform — abstractions plateforme cross-target
    ├── platform-web/              # @nexus/platform-web — implémentation platform pour le web
    └── landing/                   # @nexus/landing — pages publiques (build statique)
```

Chaque package a son propre `package.json` et son propre `tsconfig`, pilotable
via Turborepo (`pnpm dev`, `pnpm build`, `pnpm test`, ou les recettes `just`
équivalentes).

Nexus a deux couches distinctes :

- **Messagerie** — 12 services (Discord, WhatsApp, Messenger, Telegram,
  Instagram, Slack, Teams, LinkedIn, X, Reddit, TikTok, Snapchat) encapsulés
  en **webview** côté desktop. Nexus n'agit jamais comme bridge serveur, ne
  lit ni ne stocke aucun message (cf. ADR-027).
- **Organisation** — événements, sondages, dépenses partagées, todos, chacun
  avec sa page publique partageable (liens `/e /p /d /t /l`) — le vrai cœur
  métier applicatif, entièrement piloté par API REST/WS.

## Stack technique

**Backend**

- Node.js 22+, TypeScript strict
- [Fastify](https://fastify.dev/)
- [Drizzle ORM](https://orm.drizzle.team/) sur PostgreSQL
- Redis pour cache + sessions + pub/sub WebSocket
- [BullMQ](https://docs.bullmq.io/) pour les workers asynchrones (rappels d'events, purge notifs)
- WebSocket via `ws` avec protocole maison typé
- JWT access + refresh httpOnly cookie + CSRF (cf. ADR-015)

**Web frontend**

- React 18 + Vite
- [TanStack Router](https://tanstack.com/router) pour le routing typé
- [TanStack Query](https://tanstack.com/query) avec optimistic mutations sur RSVP/vote/todo/expense/notif
- [Zustand](https://zustand-demo.pmnd.rs/) pour le state global (auth, thème)
- Design system v2 — inspiré Apple HIG (Space Gray dark, surfaces glass, Phosphor icons)
- Schémas Zod pour la validation runtime des réponses backend

**Desktop**

- [Tauri 2](https://v2.tauri.app/) — binaire ~10-15 Mo vs ~150 Mo Electron
- Window borderless avec contrôles flottants intégrés
- Multi-webview embarquée : chaque session de messagerie a sa vraie webview
  native avec `data_directory` isolé (cookies persistés par provider)
- Auto-update via `tauri-plugin-updater`, releases GitHub signées

**Conteneurisation dev**

- Docker Compose : PostgreSQL 16 + Redis 7

> Une détection d'intention par IA (API Claude) a été explorée puis
> **abandonnée** (ADR-032) : sans lecture des messages côté serveur, cette
> fonctionnalité n'avait plus de surface d'application. Nexus ne dépend
> d'aucune API IA.

## Setup

### Pré-requis

| Outil            | Version   | Pour quoi                                   |
| ---------------- | --------- | ------------------------------------------- |
| Node             | 22+       | Tout                                        |
| pnpm             | 9+        | Monorepo                                    |
| Docker Desktop   | récent    | Postgres + Redis                            |
| Rust + Cargo     | stable    | Compiler Tauri (uniquement pour le desktop) |
| MSVC Build Tools | (Windows) | Linker requis par Cargo                     |

### Installation

```bash
git clone https://github.com/Manuxv3-dev/nexus.git
cd nexus
just install

# Installer les hooks de pre-commit (commitlint, prettier, eslint, garde-fous ADR)
just hooks-install

# Démarrer les services (Postgres + Redis)
just compose-up

# Migrer la DB
just migrate

# Vérifier que tout passe
just verify
```

`just doctor` diagnostique l'outillage manquant. `just --list` affiche toutes
les recettes. Les scripts `pnpm` restent utilisables directement — `just`
n'est qu'une façade stable et documentée par-dessus.

### Variables d'environnement

Copier `packages/backend/.env.example` vers `packages/backend/.env` et
remplir les secrets (OAuth, JWT, clé API Resend pour les emails, etc.).

### Lancer en mode dev (Windows)

Le script `scripts/dev-start.bat` automatise tout :

```powershell
# Mode Tauri (défaut) — lance backend + workers + Tauri (fenêtre native)
.\scripts\dev-start.bat

# Mode web — lance backend + workers + Vite (navigateur)
.\scripts\dev-start.bat web
```

Le script démarre Docker Desktop si besoin, lève Postgres + Redis via
`docker compose`, puis ouvre Windows Terminal avec les onglets Backend,
Worker Reminders, Worker Purge (Tauri uniquement) et Tauri/Web.

### Lancer en mode dev (manuel, multi-OS)

```bash
# Terminal 1 — Postgres + Redis
pnpm compose:up

# Terminal 2 — Backend
pnpm --filter @nexus/backend dev

# Terminal 3 — Worker reminders (BullMQ rappels d'events)
pnpm --filter @nexus/backend dev:worker:reminders

# Terminal 4 — Worker purge (BullMQ purge nocturne notifs)
pnpm --filter @nexus/backend dev:worker:purge

# Terminal 5 — soit le web (navigateur), soit Tauri (fenêtre native)
pnpm --filter @nexus/web dev
# OU
pnpm tauri:dev
```

Setup Rust/Tauri détaillé : [`packages/desktop/README.md`](../packages/desktop/README.md).

## Scripts utiles

| Commande                | Effet                                              |
| ----------------------- | -------------------------------------------------- |
| `just verify`           | Les gates : lint + format-check + typecheck + test |
| `just dev`              | Turbo : tous les packages en watch                 |
| `just tauri-dev`        | Lance Tauri (spawn Vite via `beforeDevCommand`)    |
| `just tauri-build`      | Build le binaire Tauri (.app/.exe/.dmg)            |
| `just typecheck`        | Vérifie le typage de tous les packages             |
| `just test`             | Vitest dans tous les packages                      |
| `just test-integration` | Démarre Postgres puis lance les tests backend      |
| `just lint`             | ESLint                                             |
| `just format`           | Prettier                                           |
| `just compose-up`       | Démarre Postgres + Redis                           |
| `just compose-down`     | Arrête Postgres + Redis                            |
| `just smoke`            | Smoke test E2E contre la prod live                 |
| `just doctor`           | Diagnostique l'outillage manquant                  |

## Tests

```bash
# Tests d'intégration backend (avec Postgres réel)
pnpm --filter @nexus/backend test

# Tests unitaires web (Vitest + Testing Library)
pnpm --filter @nexus/web test

# Tests unitaires shared
pnpm --filter @nexus/shared test

# E2E Playwright (smoke path login → onboarding → app shell → switch de groupe → panel feature)
pnpm --filter @nexus/web e2e
```

Les tests d'intégration backend détectent automatiquement si Postgres est
joignable et se skippent sinon (utile en sandbox sans DB) — un run vert sans
base ne prouve donc rien sur ces tests-là. L'E2E `just e2e` démarre
backend + web lui-même ; Postgres/Redis doivent déjà tourner
(`just compose-up`) avec `DATABASE_URL` pointant une base jetable (l'E2E crée
de vrais users/groupes en base à chaque run).

## Conventions

- **Conventional Commits** obligatoires, validés par commitlint en local
  (hook `commit-msg`) **et** sur les PR.
- **Hooks de pre-commit** (`.pre-commit-config.yaml`) : commitlint, prettier,
  eslint zéro warning, et un garde-fou qui bloque la réintroduction d'une
  dépendance de bridge de messagerie ou de SDK IA (ADR-027 / ADR-032).
  `just hooks-install` après un clone.
- **Pipeline ADLC** (plugin `adlc@hg-toolkit`) : `/adlc:refine` →
  `/adlc:plan` → `/adlc:breakdown` → `/adlc:execute` → `/adlc:pr`. Les specs
  et plans techniques vivent dans les tickets
  [Linear](https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7), pas
  dans des fichiers.
- **TypeScript strict** partout (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
- **Schémas Zod** comme source de vérité pour toute donnée traversant une
  frontière (API REST, WS, DB, providers de messagerie).
- **ADR obligatoires** pour toute décision structurante — immuables une fois
  acceptés ; pour révoquer, un nouvel ADR remplace l'ancien.
- **Optimistic mutations** par défaut sur les actions UI critiques (RSVP,
  vote, cocher une todo, etc.) avec rollback automatique en cas d'erreur
  backend.

## Choix structurants (ADR)

Décisions notables qui ont façonné l'architecture actuelle :

| Décision                                                           | ADR                             |
| ------------------------------------------------------------------ | ------------------------------- |
| Stack monorepo pnpm + Turborepo                                    | ADR-001                         |
| Drizzle ORM (vs Prisma)                                            | ADR-002                         |
| WebSocket protocole maison typé via `@nexus/shared`                | ADR-003                         |
| JWT access court + refresh httpOnly                                | ADR-004                         |
| Multi-tenant : `groupId` dès le départ                             | ADR-005                         |
| **Messagerie : encapsulation webview** (vs bridges serveur custom) | ADR-022, généralisée en ADR-027 |
| Design System v2 inspiré Apple HIG                                 | ADR-021                         |
| Notifications transverses (rappels + RSVP + expenses + todos)      | ADR-023                         |
| **Shell desktop Tauri 2** (multi-webview embarquée)                | ADR-026                         |
| **Abandon du détecteur d'intention IA**                            | ADR-032                         |
| Pipeline de release desktop (signing, auto-update)                 | ADR-031                         |
| Cargo.toml source unique de la version desktop                     | ADR-035                         |

35 ADR au total — liste complète dans [`.agent/adr/`](../.agent/adr/), chacun
immuable une fois accepté.

## Roadmap

Le cap produit et la priorisation vivent dans
[`.agent/roadmap.md`](../.agent/roadmap.md) (vue long terme) et dans le
[projet Linear](https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7)
(état d'avancement détaillé, ticket par ticket) — pas dupliqués ici pour
éviter une seconde source de vérité qui dérive.
