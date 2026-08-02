# Nexus

Une seule app pour discuter, planifier et partager — sans jongler entre dix
outils. Nexus agrège **Discord, WhatsApp, Messenger** + 9 autres messageries
(Telegram, Instagram, Slack, Microsoft Teams, LinkedIn, X, Reddit, TikTok,
Snapchat) dans une même interface, augmentée d'une couche d'organisation pour
bandes d'amis : agenda partagé, événements avec RSVP, sondages temps réel,
dépenses partagées (style Tricount), todos collaboratives.

> Pour les conversations on garde les apps officielles (rien ne transite par
> Nexus, tout reste côté provider via webview encapsulée — cf. ADR-027).
> Pour le reste — _« qui amène quoi samedi ? »_, _« on fait ça quand ? »_,
> _« qui doit combien à qui ? »_ — Nexus est l'endroit unique.

## Statut actuel

| Surface             | État                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend**         | OK Fastify + PostgreSQL + Redis + 2 workers BullMQ (event-reminders + notifs purge) + WebSocket (port 3000)                                                     |
| **Web app**         | OK Vite/React, design system v2 Apple, login/auth, dashboards killer features, Home Nexus, notifications transverses                                            |
| **Desktop**         | OK Tauri 2 — encapsulation webview native pour les 12 messageries supportées                                                                                    |
| **Mobile**          | À venir : React Native / Expo (J9-J10, pas démarré)                                                                                                             |
| **Providers**       | OK 12 messageries via webview encapsulée (Discord, WhatsApp, Messenger, Telegram, Instagram, Slack, Teams, LinkedIn, X, Reddit, TikTok, Snapchat) — cf. ADR-027 |
| **Killer features** | OK Events + RSVP · OK Polls · OK Expenses (Tricount-like) · OK Todos partagées                                                                                  |
| **Notifications**   | OK Transverses cross-feature (rappels events, RSVP, expenses, todos) — table dédiée + WS push + UI panel                                                        |
| **Déploiement**     | À venir : VPS Hostinger — ADR-011/012 prêts, code à pousser                                                                                                     |

Cf. le [projet Linear](https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7)
pour l'état d'avancement détaillé et [`.agent/roadmap.md`](.agent/roadmap.md)
pour le cap produit.

## Architecture

```
nexus/
├── .agent/                        # Mémoire vivante du projet (ADR, skills, roadmap, backlog)
│   ├── adr/                       # 27 Architecture Decision Records
│   ├── skills/                    # Procédures et patterns réutilisables
│   └── …
├── docker-compose.dev.yml         # PostgreSQL 16 + Redis 7 pour le dev
├── scripts/dev-start.bat          # Lanceur complet stack (compose + workers + tauri)
└── packages/
    ├── backend/                   # @nexus/backend — API Fastify (sessions + killer features), workers BullMQ
    ├── web/                       # @nexus/web — React/Vite, frontend universel
    ├── desktop/                   # @nexus/desktop — Shell Tauri 2 (webviews encapsulées 12 messageries)
    ├── shared/                    # @nexus/shared — types, schémas Zod, contrats WS
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
- [BullMQ](https://docs.bullmq.io/) pour les workers asynchrones (rappels d'events, purge notifs)
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
les recettes. Les scripts `pnpm` restent utilisables directement — `just` n'est
qu'une façade stable et documentée par-dessus.

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
3. Ouvre Windows Terminal avec 3-4 onglets : Backend, Worker Reminders,
   Worker Purge (Tauri uniquement), Tauri/Web

> Depuis ADR-027 (universalisation webview messaging), il n'y a plus de
> Worker Discord — toutes les messageries passent par la webview Tauri
> côté front, sans worker serveur.

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

# Terminal 5 — soit le web (navigateur), soit Tauri (window native)
pnpm --filter @nexus/web dev
# OU
pnpm tauri:dev
```

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

# Tests unitaires shared
pnpm --filter @nexus/shared test
```

Les tests intégrations détectent automatiquement si Postgres est joignable et se
skipent sinon (utile en sandbox sans DB).

## Conventions

- **Conventional Commits** obligatoires, validés par commitlint en local (hook
  `commit-msg`) **et** sur les PR. Types : `feat`, `fix`, `docs`, `style`,
  `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Hooks de pre-commit** (`.pre-commit-config.yaml`) : commitlint, prettier,
  eslint zéro warning, garde-fous génériques, et un garde-fou qui bloque la
  réintroduction d'une dépendance de bridge ou de SDK IA (ADR-027 / ADR-032).
  `just hooks-install` après un clone.
- **Pipeline ADLC** : `/adlc:refine` → `/adlc:plan` → `/adlc:breakdown` →
  `/adlc:execute` → `/adlc:pr`. Les specs et plans vivent dans les tickets
  Linear, pas dans des fichiers. Labels `feature` / `chore` / `bug` en
  minuscules strictes.
- **TypeScript strict** partout (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
- **Schémas Zod** comme source de vérité pour toute donnée traversant une
  frontière (API REST, WS, DB, providers de messagerie).
- **ADR obligatoires** pour toute décision structurante. Immuables une fois
  acceptés — pour révoquer, créer un nouvel ADR qui remplace.
- **Optimistic mutations** par défaut sur les actions UI critiques (RSVP, vote,
  cocher todo, etc.) avec rollback automatique en cas d'erreur backend.

## Choix structurants notables

| Décision                                                           | ADR               |
| ------------------------------------------------------------------ | ----------------- |
| Stack monorepo pnpm + Turborepo                                    | ADR-001           |
| Drizzle ORM (vs Prisma)                                            | ADR-002           |
| WebSocket protocole maison typé via `@nexus/shared`                | ADR-003           |
| JWT access court + refresh httpOnly                                | ADR-004           |
| Multi-tenant : `groupId` dès le départ                             | ADR-005           |
| Discord : API officielle bot + OAuth user                          | ADR-006           |
| **WhatsApp/Messenger : encapsulation webview** (vs bridges custom) | ADR-022           |
| Web app prioritaire + auth cookie/CSRF                             | ADR-014 + ADR-015 |
| Worker BullMQ pour rappels events                                  | ADR-020           |
| **Design System v2 true Apple HIG**                                | ADR-021           |
| Notifications transverses (rappels + RSVP + expenses + todos)      | ADR-023           |
| Home Nexus + préférence d'atterrissage post-login                  | ADR-024           |
| WA/Messenger Phase A (placeholder web)                             | ADR-025           |
| **WA/Messenger Phase B (Tauri 2 + multi-webview embedded)**        | ADR-026           |

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

- [`CLAUDE.md`](CLAUDE.md) — cadre de travail de l'agent : sources de vérité,
  décisions à ne pas re-questionner, cycle ADLC, gates, pièges connus
- [`.agent/README.md`](.agent/README.md) — index de la mémoire durable du projet
- [`.agent/adr/`](.agent/adr/) — 34 Architecture Decision Records (immuables)
- [`.agent/skills/`](.agent/skills/) — patterns et procédures réutilisables
- [`.agent/notes/`](.agent/notes/) — notes de contexte, recherches, briefs
- [`.agent/archive/`](.agent/archive/) — suivi de tâches d'avant la bascule ADLC
- [Projet Linear](https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7) —
  specs, plans techniques et statut des tâches
- [`packages/desktop/README.md`](packages/desktop/README.md) — setup Rust /
  Tauri pour le shell desktop

## Licence

À définir avant publication. Repo privé pour le moment.
