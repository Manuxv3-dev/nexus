# Nexus

Une seule app pour discuter, planifier et partager — sans jongler entre dix
outils. Nexus agrège **Discord, WhatsApp et Messenger** dans une même interface,
augmentée d'une couche d'organisation pour bandes d'amis : agenda partagé,
événements avec RSVP, sondages temps réel, dépenses partagées (style Tricount),
todos collaboratives.

> Pour les conversations on garde Meta/Discord (rien ne transite par Nexus).
> Pour le reste — *« qui amène quoi samedi ? »*, *« on fait ça quand ? »*,
> *« qui doit combien à qui ? »* — Nexus est l'endroit unique.

## Statut actuel

| Surface | État |
|---|---|
| **Backend** | OK Fastify + PostgreSQL + Redis + 3 workers BullMQ + WebSocket (port 3000) |
| **Web app** | OK Vite/React, design system v2 Apple, login/auth, dashboards killer features, Home Nexus, notifications transverses |
| **Desktop** | OK Tauri 2 — vraie encapsulation native WhatsApp Web + Messenger via webviews enfants embedded |
| **Mobile** | À venir : React Native / Expo (J9-J10, pas démarré) |
| **Providers** | OK Discord (API officielle bot/user) · OK WhatsApp (encapsulation web) · OK Messenger (encapsulation web) |
| **Killer features** | OK Events + RSVP · OK Polls · OK Expenses (Tricount-like) · OK Todos partagées |
| **Notifications** | OK Transverses cross-feature (rappels events, RSVP, expenses, todos) — table dédiée + WS push + UI panel |
| **Déploiement** | À venir : VPS Hostinger — ADR-011/012 prêts, code à pousser |

Cf. [`.agent/current-task.md`](.agent/current-task.md) pour l'état d'avancement
détaillé et [`.agent/roadmap.md`](.agent/roadmap.md) pour la roadmap.

## Architecture

```
nexus/
├── .agent/                        # Mémoire vivante du projet (ADR, skills, roadmap, backlog)
│   ├── adr/                       # 26 Architecture Decision Records
│   ├── skills/                    # Procédures et patterns réutilisables
│   └── …
├── docker-compose.dev.yml         # PostgreSQL 16 + Redis 7 pour le dev
├── scripts/dev-start.bat          # Lanceur complet stack (compose + workers + tauri)
└── packages/
    ├── backend/                   # @nexus/backend — API Fastify, workers BullMQ, intégration Discord
    ├── web/                       # @nexus/web — React/Vite, frontend universel
    ├── desktop/                   # @nexus/desktop — Shell Tauri 2 (webviews encapsulées WA/Messenger)
    ├── shared/                    # @nexus/shared — types, schémas Zod, contrats WS, MessagingProvider
    ├── platform/                  # @nexus/platform — abstractions plateforme cross-target
    ├── platform-web/              # @nexus/platform-web — implémentation platform pour web
    └── landing/                   # @nexus/landing — pages publiques (build statique)
```

Chaque package a son propre `package.json`, son propre `tsconfig`, et est
pilotable via Turborepo (`pnpm dev`, `pnpm build`, `pnpm test`).

## Stack technique

**Backend**
- Node.js 22+ TypeScript strict
- [Fastify](https://fastify.dev/) (préféré à Express pour les perfs et le typage)
- [Drizzle ORM](https://orm.drizzle.team/) sur PostgreSQL
- Redis pour cache + sessions + pub/sub WebSocket
- [BullMQ](https://docs.bullmq.io/) pour les workers asynchrones (rappels d'events, purge notifs, bridge Discord)
- WebSocket via `ws` avec protocole maison typé
- JWT access + refresh httpOnly cookie + CSRF (cf. ADR-015)

**Web frontend**
- React 18 + Vite
- [TanStack Router](https://tanstack.com/router) pour le routing typé
- [TanStack Query](https://tanstack.com/query) avec optimistic mutations sur RSVP/vote/todo/expense/notif
- [Zustand](https://zustand-demo.pmnd.rs/) pour le state global (auth, theme)
- Design System v2 — true Apple HIG (Space Gray dark, Liquid Glass surfaces, Phosphor icons)
- Schémas Zod pour validation runtime des réponses backend

**Desktop**
- [Tauri 2](https://v2.tauri.app/) — binaire ~10-15MB vs ~150MB Electron
- Window borderless avec contrôles flottants intégrés
- Multi-webview embedded : chaque session WA/Messenger = vraie webview native avec `data_directory` isolé (cookies persistés)

**Conteneurisation dev**
- Docker Compose : PostgreSQL 16 + Redis 7

**IA** (futur)
- API Claude (Anthropic) pour la détection d'intention dans les messages bridges

## Setup

### Pré-requis

| Outil | Version | Pour quoi |
|---|---|---|
| Node | 22+ | Tout |
| pnpm | 9+ | Monorepo |
| Docker Desktop | récent | Postgres + Redis |
| Rust + Cargo | stable | Compiler Tauri (uniquement pour le desktop) |
| MSVC Build Tools | (Windows) | Linker requis par Cargo |

### Installation

```bash
git clone https://github.com/<ton-user>/nexus.git
cd nexus
pnpm install

# Démarrer les services (Postgres + Redis)
pnpm compose:up

# Migrer la DB
pnpm --filter @nexus/backend db:migrate

# Vérifier le typage
pnpm typecheck
```

### Variables d'environnement

Copier `packages/backend/.env.example` vers `packages/backend/.env` et remplir
les secrets (Discord OAuth client ID/secret, JWT secrets, etc.).

### Lancer en mode dev (Windows)

Le script `scripts/dev-start.bat` automatise tout :

```powershell
# Mode Tauri (defaut) — lance backend + 3 workers + Tauri (window native)
.\scripts\dev-start.bat

# Mode web — lance backend + 3 workers + Vite (navigateur)
.\scripts\dev-start.bat web
```

Le script :
1. Démarre Docker Desktop si besoin + attend le daemon
2. Up Postgres + Redis via `docker compose`
3. Ouvre Windows Terminal avec 4-5 onglets : Backend, Worker Discord, Worker
   Reminders, Worker Purge, Tauri/Web

### Lancer en mode dev (manuel, multi-OS)

```bash
# Terminal 1 — Postgres + Redis
pnpm compose:up

# Terminal 2 — Backend
pnpm --filter @nexus/backend dev

# Terminal 3 — Worker Discord bridge
pnpm --filter @nexus/backend dev:worker:discord

# Terminal 4 — Worker reminders (BullMQ)
pnpm --filter @nexus/backend dev:worker:reminders

# Terminal 5 — soit le web (navigateur), soit Tauri (window native)
pnpm --filter @nexus/web dev
# OU
pnpm tauri:dev
```

## Scripts utiles

| Commande              | Effet                                               |
|-----------------------|-----------------------------------------------------|
| `pnpm dev`            | Turbo : tous les packages en watch                  |
| `pnpm tauri:dev`      | Lance Tauri (spawn Vite via `beforeDevCommand`)     |
| `pnpm tauri:build`    | Build le binaire Tauri (.app/.exe/.dmg)             |
| `pnpm typecheck`      | Vérifie le typage de tous les packages              |
| `pnpm test`           | Vitest dans tous les packages                       |
| `pnpm lint`           | ESLint                                              |
| `pnpm format`         | Prettier                                            |
| `pnpm compose:up`     | Démarre Postgres + Redis                            |
| `pnpm compose:down`   | Arrête Postgres + Redis                             |

## Tests

```bash
# Tests d'intégration backend (avec Postgres réel)
pnpm --filter @nexus/backend test

# Tests unitaires shared
pnpm --filter @nexus/shared test
```

Les tests intégrations détectent automatiquement si Postgres est joignable et se
skipent sinon (utile en sandbox sans DB).

## Conventions

- **Conventional Commits** obligatoires (validés par commitlint sur les PR).
  Types : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`.
- **TypeScript strict** partout (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
- **Schémas Zod** comme source de vérité pour toute donnée traversant une
  frontière (API REST, WS, DB, providers de messagerie).
- **ADR obligatoires** pour toute décision structurante. Immuables une fois
  acceptés — pour révoquer, créer un nouvel ADR qui remplace.
- **Optimistic mutations** par défaut sur les actions UI critiques (RSVP, vote,
  cocher todo, etc.) avec rollback automatique en cas d'erreur backend.

## Choix structurants notables

| Décision | ADR |
|---|---|
| Stack monorepo pnpm + Turborepo | ADR-001 |
| Drizzle ORM (vs Prisma) | ADR-002 |
| WebSocket protocole maison typé via `@nexus/shared` | ADR-003 |
| JWT access court + refresh httpOnly | ADR-004 |
| Multi-tenant : `groupId` dès le départ | ADR-005 |
| Discord : API officielle bot + OAuth user | ADR-006 |
| **WhatsApp/Messenger : encapsulation webview** (vs bridges custom) | ADR-022 |
| Web app prioritaire + auth cookie/CSRF | ADR-014 + ADR-015 |
| Worker BullMQ pour rappels events | ADR-020 |
| **Design System v2 true Apple HIG** | ADR-021 |
| Notifications transverses (rappels + RSVP + expenses + todos) | ADR-023 |
| Home Nexus + préférence d'atterrissage post-login | ADR-024 |
| WA/Messenger Phase A (placeholder web) | ADR-025 |
| **WA/Messenger Phase B (Tauri 2 + multi-webview embedded)** | ADR-026 |

26 ADRs au total — voir [`.agent/adr/`](.agent/adr/).

## Roadmap (restant)

**Court terme**
- Polish Tauri (vraies icônes Nexus, hide/show webview au lieu de destroy/recreate)
- Déploiement VPS Hostinger (ADR-011 + ADR-012)
- Notifications push PWA (Web Push API + service worker)
- Code signing pour distribution publique (Apple Dev cert + Windows EV cert)
- Auto-update Tauri via `tauri-plugin-updater`

**Moyen terme**
- Détecteur d'intention via API Claude (lit les messages bridges, suggère
  inline créer event / lancer sondage / ajouter dépense)
- Application mobile React Native + Expo

## Documentation

- [`.agent/README.md`](.agent/README.md) — index de la documentation projet
- [`.agent/adr/`](.agent/adr/) — 26 Architecture Decision Records (immuables)
- [`.agent/skills/`](.agent/skills/) — patterns et procédures réutilisables
- [`packages/desktop/README.md`](packages/desktop/README.md) — setup Rust /
  Tauri pour le shell desktop
- `.agent/notes/` — notes de contexte, recherches, brouillons

## Licence

À définir avant publication. Repo privé pour le moment.
