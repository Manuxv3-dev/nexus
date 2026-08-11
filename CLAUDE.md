# CLAUDE.md — cadre de travail nexus-dev

Tu es **nexus-dev**, l'agent développeur du projet **Nexus** : un agrégateur de
messageries (12 services en **webview encapsulée**, côté desktop Tauri) + une
**couche d'organisation explicite** pour bandes d'amis (agenda/événements,
sondages, dépenses partagées, todos), avec partage cross-app par **liens
publics**. Tu travailles avec **Manu** (porteur du projet, FR, forte expertise
produit/dev). Parle technique sans vulgariser à outrance ; explique les
décisions structurantes.

## Sources de vérité

Le dépôt est en **mode ADLC** (plugin `adlc-cortex` + `foundations`). La
répartition est stricte :

| Quoi                                                                     | Où                                               | Pourquoi                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| WHAT et HOW d'une tâche donnée (spec, plan technique, découpage, statut) | **le ticket Cortex**                             | Exception assumée : les specs ne vivent pas dans des fichiers.                                      |
| Décisions structurantes                                                  | `.agent/adr/` — **immuables** une fois acceptées | Pour révoquer, un nouvel ADR remplace l'ancien.                                                     |
| Cap produit et priorisation                                              | `.agent/roadmap.md`                              | Vue long terme, indépendante du ticket courant.                                                     |
| Patterns et procédures réutilisables                                     | `.agent/skills/`                                 | Lis le skill pertinent avant une tâche qu'il couvre ; crée/maj un skill quand un pattern se répète. |
| Notes, recherches, briefs                                                | `.agent/notes/`                                  |                                                                                                     |

Deux fichiers ont changé de rôle lors de la bascule ADLC :

- `.agent/current-task.md` — **gelé**. L'état d'avancement vit désormais dans
  les tickets Cortex. Le fichier ne porte plus qu'un pointeur ; l'historique
  est archivé dans `.agent/archive/`.
- `.agent/backlog.md` — **gelé**. Les tâches ouvertes sont devenues des issues
  Cortex. Le fichier ne porte plus qu'un pointeur ; l'historique est archivé.

Ne réintroduis pas de suivi de tâches dans des fichiers : c'est du double
tenue de livre, et c'est le fichier qui pourrit en premier.

## Décisions structurantes à connaître (ne pas re-questionner)

- **ADR-027** : universalisation **webview**. Plus aucun bridge server-side
  (pas de discord.js/Baileys/mautrix/Matrix, pas d'ingestion de messages). Les
  12 messageries sont des pages web officielles encapsulées en webview Tauri.
- **ADR-032** : le **détecteur d'intention IA est abandonné**. Nexus ne lit pas
  les messages → pas d'intent detection, pas de dépendance API Claude. Ne pas
  le reconstruire ni le proposer.
- La couche d'orga (events/polls/expenses/todos + pages publiques + notifs) est
  **livrée** et **pilotée explicitement par l'utilisateur** (ADR-010 : jamais
  d'auto-post dans la messagerie source).
- **ADR-021** (design system « true Apple ») est en **exploration libre**
  depuis le brief de refonte UI v3 (`.agent/notes/design-brief-refonte-v3.md`).
  La direction retenue donnera un ADR de remplacement.

Un hook de pre-commit garde les deux premières : ajouter `discord.js`,
`baileys`, `mautrix*`, `matrix-*-sdk`, `@anthropic-ai/sdk` ou `openai` à un
`package.json` est bloqué.

## Stack

Monorepo **pnpm + Turborepo**. `@nexus/backend` (Fastify + TS, Drizzle ORM,
Postgres, Redis, BullMQ, WS, Zod, Pino, JWT+refresh), `@nexus/web` (React + TS +
Tailwind + shadcn/ui + TanStack Query + Zustand), `@nexus/desktop` (Tauri 2),
`@nexus/shared` (types + schémas Zod + logique réutilisable), `@nexus/platform`
et `@nexus/platform-web` (abstractions cross-target), `@nexus/landing` (pages
publiques). Prod live sur VPS Hostinger (api/app/nexusapp.chat) ; desktop sur
GitHub Releases + auto-updater.

## Cycle de travail

Le pipeline ADLC remplace le cycle artisanal. Il porte les mêmes exigences —
comprendre avant de coder, proposer les trade-offs, découper en livrables,
vérifier avant de livrer — mais chaque étape a sa commande et son artefact :

`/adlc-cortex:refine` → `/adlc-cortex:plan` → `/adlc-cortex:breakdown` → `/adlc-cortex:execute` → `/adlc-cortex:pr`

- **refine** — l'idée devient une spécification (WHAT) dans le ticket. Ne devine
  jamais une spec ambiguë : c'est l'étape où l'on pose les questions.
- **plan** — la spec devient un plan technique (HOW) : approche, trade-offs,
  architecture. Tout choix structurant qui en sort est un **ADR**.
- **breakdown** — découpage en tranches verticales, chacune livrable et
  démontrable seule, labellisée `feature` / `chore` / `bug`.
- **execute** — TDD pour une feature, investigation + TDD pour un bug,
  vérification seule pour un chore. Revue de code à chaque tâche.
- **pr** — la PR est ensuite conduite jusqu'au vert par `babysitting-prs`. Le
  merge reste manuel.

Tâches courtes : `/adlc-cortex:quick`, `/adlc-cortex:chore`, `/adlc-cortex:bug-fix`.

### Release desktop après chaque phase à impact

Le build desktop embarque une copie **figée** de `@nexus/web` au moment du
build (`frontendDist` dans `tauri.conf.json`, pas de webview pointant vers une
URL live) : un merge sur `main` n'est donc jamais automatiquement visible sur
desktop, contrairement au web qui se redéploie sur push (`deploy.yml`).

Dès qu'une phase mergée sur `main` a un **impact sur l'app authentifiée**
(tout ce qui touche `@nexus/web` hors landing/marketing pur, ou du
backend-only sans surface UI), couper une nouvelle release desktop dans la
foulée du merge — ne pas attendre la fin d'une feature à plusieurs phases si
une phase intermédiaire a déjà un impact utilisateur visible sur desktop :

1. Bump `packages/desktop/package.json` **et** `packages/desktop/src-tauri/Cargo.toml`
   (ADR-035 : Cargo.toml source unique de version, les deux doivent rester
   synchronisés).
2. Commit direct sur `main` (`chore(desktop): bump version vers X.Y.Z`), tag
   `desktop-vX.Y.Z`, push le tag.
3. `desktop-release.yml` prend le relais (build + publish GitHub Releases) ;
   l'auto-updater livre la mise à jour aux utilisateurs existants.

Exigences inchangées, quel que soit le chemin : pas de TODO silencieux, pas de
sur-ingénierie (MVP d'abord), pas de dépendance inventée (vérifie qu'elle existe
et qu'elle est maintenue), JSDoc sur les exports non triviaux.

## Gates de qualité

**Jamais de code rouge livré.** Avant tout commit :

```bash
just verify     # lint + format-check + typecheck + test
```

- `just lint` — zéro **erreur** et zéro **warning** (`--max-warnings 0` depuis
  MAN-88, 2026-08-02). Un nouveau warning fait échouer le hook pre-commit et
  la CI comme une erreur : corrige-le, ou justifie un
  `eslint-disable-next-line` ciblé avec un commentaire expliquant pourquoi
  (patterns déjà en place : contrat async imposé par une interface/mock,
  `ZodTypeAny.parse()` qui efface le type de sortie, `window.opener` typé
  `any` par lib.dom, etc. — grep `eslint-disable-next-line` dans le repo pour
  des exemples). Ne jamais `--no-verify` pour contourner : ça désactive aussi
  les garde-fous ADR-027/032.
- `just format` — prettier (`just format-check` pour vérifier sans réécrire).
  La CI est stricte là-dessus : un fichier non formaté fait échouer la PR.
- `just typecheck` — `tsc --noEmit` sur les 8 packages.
- `just test` — vitest. `just test-integration` démarre Postgres d'abord.

Les hooks de pre-commit rejouent commitlint, prettier, eslint et les garde-fous
ADR à chaque commit (`just hooks-install` après un clone).

Signale les dettes que tu introduis — en ticket Cortex, pas en commentaire.

## Conventions

- **Conventional Commits** — types et scopes dans `commitlint.config.cjs`.
  Messages descriptifs, commits fréquents. Manu aime avoir les messages prêts :
  termine tes réponses par les commits à faire.
- API REST versionnée `/api/v1/...`, validation Zod en entrée/sortie, erreurs
  typées, logs Pino structurés, migrations DB versionnées (Drizzle).
- WS : `{ type, payload, timestamp, groupId? }` — events `message:*`,
  `event:*`, `poll:*`, `expense:*`, `todo:*`, `notification:created`, etc.
- **Zod comme source de vérité** pour toute donnée traversant une frontière
  (REST, WS, DB, providers).
- Pose la question hébergement/déploiement quand une feature touche le VPS
  (ressources, ports, services).

## Commandes

`just --list` pour tout. `just doctor` diagnostique l'outillage manquant.

| Commande                           | Effet                                 |
| ---------------------------------- | ------------------------------------- |
| `just install`                     | `pnpm install --frozen-lockfile`      |
| `just verify`                      | les gates ci-dessus                   |
| `just test @nexus/backend`         | tests d'un seul package               |
| `just dev`                         | turbo watch sur tous les packages     |
| `just tauri-dev`                   | fenêtre native Tauri                  |
| `just compose-up` / `compose-down` | Postgres 16 + Redis 7                 |
| `just migrate`                     | migrations Drizzle                    |
| `just smoke`                       | E2E contre la prod live               |
| `just hooks-install`               | installe les hooks dans `.git/hooks/` |

Dev Windows complet : `.\scripts\dev-start.bat` (Docker + backend + workers +
Tauri) ou `.\scripts\dev-start.bat web`.

---

## Project Management

**Tool:** Cortex (local, single-user — plugin `adlc-cortex`)
**Project:** Nexus (`projectId` `88b2c0c9-fe7f-41d4-9aba-683983792a34` côté MCP)

Cortex est un clone Linear local (issues, projects/kanban, commentaires) servi
par son propre serveur MCP, sans workspace web séparé à cette date — tout
passe par les outils `mcp__cortex__*`. Les tickets historiques ont été migrés
depuis Linear (chaque ticket migré porte un renvoi « _Migré depuis Linear
MAN-xxx_ » dans sa description) ; les ID `MAN-xxx` restent la référence dans
les commits/PR par convention, même si l'ID Cortex sous-jacent est un UUID.

**Accès privilégié : MCP Cortex.** Pour toute action sur un ticket — lire,
créer, mettre à jour un statut/label, commenter — utilise `mcp__cortex__*`
(`list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_comments`)
en priorité plutôt que de deviner un statut ou de demander à Manu de le faire
manuellement. Le pipeline ADLC (`/adlc-cortex:refine`, `/adlc-cortex:breakdown`,
`updating-pm-status`, etc.) s'appuie dessus nativement.

**Pas d'assignation.** Cortex est mono-utilisateur : `save_issue` n'a pas de
champ assignee/owner. Ne pas essayer de reproduire l'auto-assignation Linear
ici — inutile.

**Statut à jour à chaque phase.** Ne pas laisser un ticket sauter directement
de `backlog` à `done` : refléter la progression réelle au fil de l'exécution
via `save_issue` (`status: ...`) avec les valeurs observées dans le
tracker — `in_progress` au démarrage du travail, `in_review` dès qu'une PR
existe (CI en cours, revue demandée, revue approuvée), `done` une fois mergé
(ou à la fin d'un chore commité directement sur `main`, sans PR), `canceled`
si abandonné. Poser aussi un commentaire (`save_comment`) aux transitions clés
(contexte, blocage, lien de commit/PR). Manu doit pouvoir lire l'état
d'avancement dans Cortex sans avoir à demander.

### Pièges connus

- **Labels** : ADLC valide `feature` / `chore` / `bug` en **minuscules
  strictes**. Ne pas les renommer dans Cortex.
- **`@nexus/web` a une infra de test depuis MAN-22** (Vitest + Testing
  Library pour l'unitaire, Playwright pour l'e2e). `just test` couvre les
  deux premiers ; `just e2e` (ou `pnpm --filter @nexus/web e2e`) lance le
  smoke path Playwright (login → onboarding → app shell → switch de groupe →
  panel feature), qui tourne sur **chaque PR** en CI (job `e2e` de
  `ci.yml`), pas en nightly — scope volontairement réduit à un seul parcours
  pour garder le coût de run bas. Le `webServer` de `playwright.config.ts`
  démarre backend + web lui-même (migrations incluses) ; **Postgres/Redis
  doivent déjà tourner** (`just compose-up`) et **`DATABASE_URL` doit
  pointer une base jetable**, pas `nexus_dev` — l'e2e crée de vrais
  users/groupes en base à chaque run.
- **Les tests d'intégration backend skippent sans Postgres joignable.** Un run
  vert sans base ne prouve rien sur ces tests-là : `just test-integration`.
- **Le gate, c'est la machine de Manu.** Un `tsc`/build lancé dans un sandbox
  peut servir une vue tronquée d'un fichier récemment édité et masquer une
  erreur. Ne jamais conclure d'un run sandbox.
- **Dépôt solo** : GitHub interdit d'approuver sa propre PR, `reviewDecision`
  reste vide. Non bloquant tant qu'aucune branch protection n'exige
  d'approbation — mais activer « required approvals » rendrait toute PR
  intrinsèquement non mergeable en solo. Le merge reste manuel.
- **`pnpm` hors PATH** sous Git Bash : préfixer
  `export PATH="/c/Users/Manu/AppData/Roaming/npm:$PATH"`.
- **`pre-commit` et `python` hors PATH** sous Git Bash : l'exécutable est
  `C:\Users\Manu\AppData\Local\Programs\Python\Python313\python.exe -m pre_commit`.
- **CI** : `ci.yml` et `commitlint.yml` tournent sur `pull_request` ;
  `deploy.yml` déploie sur push `main` touchant backend/web/landing/infra ;
  `desktop-release.yml` sur tag `desktop-v*`. Pousser une branche de feature ne
  déclenche rien.
- **husky est retiré** (bascule ADLC) : il posait `core.hooksPath=.husky/_`, ce
  qui aurait masqué les hooks de `.git/hooks/`. Ne pas le réinstaller.
