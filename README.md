# Nexus

Plateforme d'agrégation de messageries (Discord, Messenger, WhatsApp) augmentée
d'une couche d'organisation intelligente pour bandes d'amis : agenda partagé,
événements, sondages, dépenses partagées, todos et listes collaboratives.

## État du projet

🚧 **Jalon 0 (Fondations) terminé.** Le squelette monorepo compile, les tests
passent, le lint est vert. Prêt à attaquer J1 (backend kernel).

Voir `.agent/current-task.md` pour l'état détaillé et `.agent/roadmap.md`
pour la roadmap MVP.

## Structure

```
nexus/
├── .agent/             # Mémoire vivante du projet (ADR, skills, roadmap, backlog)
├── .github/workflows/  # CI : lint, typecheck, test, build, commitlint
├── docker-compose.dev.yml  # PostgreSQL 16 + Redis 7 pour le dev
└── packages/
    ├── backend/        # @nexus/backend — API Fastify, workers, moteur de coordination
    ├── desktop/        # @nexus/desktop — App Tauri + React (à venir J4)
    └── shared/         # @nexus/shared — types, schémas Zod, logique métier portable
```

`@nexus/mobile` (React Native / Expo) sera ajouté en V2.

## Stack technique

- **Backend** : Node.js 22 + TypeScript, Fastify, PostgreSQL (Drizzle ORM), Redis,
  BullMQ, WebSocket via `ws`
- **Desktop** : Tauri + React + TailwindCSS + shadcn/ui + Zustand + TanStack Query
- **Mobile** (V2) : React Native + Expo
- **Monorepo** : pnpm 9 workspaces + Turborepo
- **IA** : API Claude (Anthropic) pour la détection d'intention

Détails et justifications dans `.agent/adr/`.

## Setup

### Pré-requis

- Node 22+ (cf. `.nvmrc`)
- pnpm 9+
- Docker (pour Postgres + Redis en dev)
- git

### Installation

```bash
# Cloner le repo (à faire une fois côté Manu)
git init -b main
git add .
git commit -m "chore: initial scaffold (J0)"

# Installer les dépendances
pnpm install

# Lancer Postgres + Redis
pnpm compose:up

# Vérifier que tout compile
pnpm typecheck
pnpm test
pnpm lint
```

### Variables d'environnement

Copier `.env.example` vers `.env` et remplir les secrets nécessaires.

## Scripts utiles

| Commande              | Effet                                               |
|-----------------------|-----------------------------------------------------|
| `pnpm dev`            | Lance tous les packages en mode dev (watch)         |
| `pnpm typecheck`      | Vérifie le typage de tous les packages              |
| `pnpm test`           | Lance les tests Vitest dans tous les packages       |
| `pnpm lint`           | ESLint sur tous les packages                        |
| `pnpm format`         | Formate avec Prettier                               |
| `pnpm format:check`   | Vérifie le formatage (utilisé en CI)                |
| `pnpm compose:up`     | Démarre Postgres + Redis                            |
| `pnpm compose:down`   | Arrête Postgres + Redis                             |
| `pnpm clean`          | Supprime tous les artefacts de build                |

## Conventions

- **Conventional Commits** obligatoires (validé par commitlint en CI sur les PR).
  Types autorisés : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **TypeScript strict** partout, avec `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, et `verbatimModuleSyntax`.
- **Schémas Zod** comme source de vérité pour toute donnée traversant une
  frontière (API, WS, DB, providers de messagerie).
- **ADR** obligatoires pour toute décision structurante (cf. `.agent/adr/`).

## Documentation

- `.agent/README.md` — index de la documentation projet
- `.agent/adr/` — 10 ADR fondateurs validés (immuables)
- `.agent/roadmap.md` — roadmap MVP J0→J9 et au-delà
- `.agent/skills/` — patterns et procédures réutilisables
- `.agent/notes/vps-hostinger.md` — état du VPS de prod

## Licence

À définir. Le projet n'est pas encore publié.
