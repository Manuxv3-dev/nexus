# ADR-001 : Structure monorepo — pnpm workspaces + Turborepo

**Date** : 2026-04-30
**Statut** : Accepté

## Contexte

Le projet Nexus est composé d'au moins quatre artefacts qui partagent du code :
- `@nexus/backend` — API Fastify, workers, moteur de coordination
- `@nexus/desktop` — app Tauri + React
- `@nexus/mobile` — React Native (V2)
- `@nexus/shared` — types, schémas Zod, logique métier portable

On veut :
1. Un dépôt unique pour faciliter les refactos transverses (typage partagé)
2. Des builds et tests rapides (cache incrémental)
3. Une CI claire qui ne rebuilde que ce qui a changé
4. Une expérience locale fluide pour `dev` parallèle backend + desktop

## Options envisagées

### 1. pnpm workspaces seul
- **Pros** : simple, rapide, pas de tooling supplémentaire, gestion correcte des hoists
- **Cons** : pas de cache de build inter-packages, pas d'orchestration de tâches dépendantes (`build` qui sait dans quel ordre lancer les packages)

### 2. Turborepo seul (sur npm/yarn)
- **Pros** : cache de build excellent, pipeline déclaratif, télémétrie utile
- **Cons** : pas idéal sans pnpm pour le node_modules ; npm/yarn moins performants sur monorepo large

### 3. pnpm workspaces + Turborepo (combo)
- **Pros** : pnpm pour la gestion des deps (rapide, strict), Turborepo pour l'orchestration et le cache. Les deux outils sont reconnus comme complémentaires (Vercel doc l'illustre explicitement).
- **Cons** : deux outils à connaître. Mais courbe d'apprentissage faible.

### 4. Nx
- **Pros** : très complet, plugins React/Node intégrés
- **Cons** : opinions fortes, génération de code automatique parfois pénible, plus lourd que nécessaire pour notre taille

## Décision

**pnpm workspaces + Turborepo.**

- pnpm gère l'install et le linking des packages internes (`workspace:*`)
- Turborepo orchestre `build`, `test`, `lint`, `typecheck` avec cache local et dépendances entre tâches
- Format du `pnpm-workspace.yaml` : `packages/*` en glob simple

## Conséquences

**Positif** :
- Builds incrémentaux rapides en CI (cache distant possible plus tard via Turbo Remote Cache)
- Refactos transverses sûrs (TypeScript voit tout le monorepo)
- `pnpm -F @nexus/backend dev` cible un package précis

**Négatif** :
- Onboarding d'un dev externe : il faut connaître pnpm (pas npm)
- Quelques pièges avec les `peerDependencies` strictes de pnpm — on documente dans le README racine au premier accroc

**Neutre** :
- Si on veut un jour publier un package open-source, le combo se prête bien (extraction propre via `pnpm publish -F`)
