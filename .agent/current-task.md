# Tâche en cours

**Statut** : ✅ J0 (Fondations) terminé. Prêt pour J1 (backend kernel).

## J0 — Fondations : livré

### Validations

- ✅ `pnpm install` — 12 paquets root + dépendances transitives, lockfile généré
- ✅ `pnpm typecheck` — 3/3 packages compilent (`@nexus/shared`, `@nexus/backend`, `@nexus/desktop`)
- ✅ `pnpm test` — 4 tests passent (3 dans shared, 1 dans backend)
- ✅ `pnpm lint` — ESLint flat config opérationnel sur tous les packages

### Livré

| Item                                        | Fichier                                |
|---------------------------------------------|----------------------------------------|
| Monorepo pnpm + Turborepo                   | `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| TypeScript strict partagé                   | `tsconfig.base.json`                   |
| ESLint 9 flat config (typescript-eslint)    | `eslint.config.js`                     |
| Prettier 3                                  | `.prettierrc.json`, `.prettierignore`  |
| Vitest config racine                        | `vitest.config.ts`                     |
| Commitlint Conventional Commits             | `commitlint.config.cjs`                |
| Docker Compose dev (Postgres 16 + Redis 7)  | `docker-compose.dev.yml`               |
| GitHub Actions CI (lint/typecheck/test)     | `.github/workflows/ci.yml`             |
| GitHub Actions commitlint sur PR            | `.github/workflows/commitlint.yml`     |
| Variables d'env documentées                 | `.env.example`                         |
| Hello world end-to-end (shared → backend)   | `packages/{shared,backend}/src/`       |
| Tests Zod dans shared                       | `packages/shared/src/health.test.ts`   |
| README racine avec setup                    | `README.md`                            |
| `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc` | racine                |

### Notes techniques pour Manu

1. **`git init` à faire côté Windows** : le mount Cowork a bloqué le git init
   côté Linux sandbox (corruption du `.git/config` au montage). À toi de
   faire `git init -b main` localement, puis premier commit conventional :
   ```
   git add .
   git commit -m "chore: initial scaffold (J0)"
   ```

2. **Premier `pnpm install` à exécuter par toi en local** : un lockfile a été
   généré côté sandbox (visible dans `pnpm-lock.yaml`), mais ré-exécuter
   `pnpm install` en local est sain pour s'assurer que le store est OK.

3. **Husky** : le `pnpm install` initial déclenchera `husky` via le script
   `prepare`. Si tu n'as pas git initialisé, le script log juste `husky:
   .git can't be found` et continue (`|| true`).

## Prochaine action — Jalon 1 (Backend kernel)

Estimation : 1 semaine.

Livrables principaux :
- Fastify 4+ avec plugins core
- Drizzle ORM + drizzle-kit, premier schéma (`users`, `groups`, `group_members`, `refresh_tokens`)
- Pino logger structuré
- Helper `defineRoute` qui infère les types Zod end-to-end
- Endpoints auth (`register`, `login`, `refresh`, `logout`, `logout-all`, `me`)
- Erreurs typées avec codes
- Squelette WebSocket authentifié JWT

Critère de validation J1 : un client peut s'inscrire, se connecter, ouvrir
une WS, recevoir un `presence:update` quand un autre user du même groupe
se connecte.

## Blockers

- Aucun blocker technique
- Côté humain : `git init` à faire par Manu
