# ADR-002 : ORM — Drizzle plutôt que Prisma

**Date** : 2026-04-30
**Statut** : Accepté

## Contexte

Le backend Nexus stocke en PostgreSQL des entités relationnelles (users, groups,
messages, events, polls, expenses, todos) avec des contraintes fortes :
- Volume de messages potentiellement élevé (sync historique multi-messageries)
- Requêtes complexes côté moteur de coordination (jointures groupes/membres/items)
- Migrations versionnées obligatoires
- Typage end-to-end : on veut que les schémas Zod, les types TS et la DB soient cohérents

## Options envisagées

### 1. Prisma
- **Pros** : ergonomie excellente, écosystème mature, Prisma Studio agréable, bonne doc
- **Cons** :
  - Génère un client volumineux (impact bundle worker, démarrage lent)
  - Schéma DSL externe (`schema.prisma`) — duplication possible avec les types TS et Zod
  - Performance moyenne sur jointures complexes (sous-requêtes générées sous-optimales)
  - Migrations couplées au format Prisma — bascule future coûteuse

### 2. Drizzle ORM
- **Pros** :
  - Schéma défini en TypeScript pur — source de vérité unique, pas de DSL externe
  - SQL-first : on écrit du quasi-SQL typé, contrôle total des requêtes
  - Très léger (pas de client généré, runtime minuscule)
  - Migrations gérées via `drizzle-kit` (introspection, génération SQL)
  - Excellent typage : les requêtes retournent des types précis sans `as`
- **Cons** :
  - Écosystème plus jeune (mais maintenu activement, soutenu par la communauté)
  - Moins d'outils visuels (Drizzle Studio existe mais moins riche que Prisma Studio)
  - Doc parfois lacunaire sur les cas avancés

### 3. Kysely
- **Pros** : query builder typé excellent, très flexible
- **Cons** : pas vraiment un ORM (pas de helpers relations natifs), gestion des migrations à apporter soi-même, moins ergonomique au quotidien

### 4. TypeORM
- **Pros** : connu, decorators familiers
- **Cons** : architecture vieillissante, problèmes de typage, communauté en perte de vitesse

## Décision

**Drizzle ORM** avec `drizzle-kit` pour les migrations.

Motivations principales :
1. Schéma TypeScript = source unique → on génère naturellement des types Zod via
   `drizzle-zod` pour l'API, puis ces types descendent dans `@nexus/shared`
2. Performance et contrôle SQL — critique pour le moteur de coordination
3. Empreinte runtime minimale — important pour les workers BullMQ
4. Pas de DSL à apprendre

## Conséquences

**Positif** :
- Pipeline de typage homogène : DB → Drizzle → Zod → TS frontend
- Requêtes performantes par défaut, optimisations triviales (index, EXPLAIN)
- Cold start backend rapide

**Négatif** :
- Devs habitués à Prisma devront s'adapter (~1 jour de prise en main)
- Outils de visualisation moins fournis — on s'appuiera sur `psql`, DBeaver ou Drizzle Studio basique

**Neutre** :
- Migrations versionnées dans `packages/backend/drizzle/migrations/` — le format SQL est lisible et auditable
- Si Drizzle posait un jour problème, l'écriture SQL-first facilite la migration vers Kysely (transition modeste)
