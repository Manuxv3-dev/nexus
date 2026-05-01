# ADR-013 : Migrations DB en prod — stratégie expand/contract

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

Drizzle ORM (cf. ADR-002) génère des migrations SQL versionnées dans
`packages/backend/drizzle/migrations/`. Le pipeline CD (ADR-011) doit
appliquer ces migrations en prod **avant** que le nouveau backend démarre,
sans interrompre le service, sans mettre la base dans un état incohérent en
cas d'échec.

Contraintes :
- Pas de fenêtre de maintenance souhaitée pour les changements simples
  (ajout de colonne, création d'index)
- Pour les changements lourds (rename, drop, contraintes), tolérer un peu
  de downtime court (< 30s) est acceptable au stade MVP
- Rollback possible si la migration casse (avant ou après deploy)
- Pas de logique applicative dans les migrations (purement DDL + données
  technique). La data migration complexe se fait via scripts à part.
- Multi-tenant `groupId` dès le départ (ADR-005) → pas de migration tenant-aware
  spécifique pour V1

## Options envisagées

### Option A — Migration appliquée par le backend au démarrage

Le backend exécute `drizzle-kit migrate` au boot, puis se met à servir.

Pros : 1 seul mécanisme.

Cons :
- Si on a 2 instances backend (futur scale horizontal), elles tentent de
  migrer en parallèle → race condition. Drizzle ne pose pas de lock.
- En cas d'échec migration : le service reste down (l'erreur empêche le
  démarrage)
- Pas de séparation entre le job migration (lourd) et le serveur HTTP (léger)

### Option B — Job container dédié exécuté avant le swap (RETENU)

Pipeline CD :
1. Pull la nouvelle image
2. **Job migration one-shot** : `docker run --rm --network nexus-internal
   ghcr.io/manuxv3-dev/nexus-backend:<sha> pnpm db:migrate`
3. Si exit 0 → `docker compose up -d backend` (swap)
4. Si exit ≠ 0 → abort, pas de swap, alert + commit comment

Pros :
- Migration et serveur découplés
- Lock explicite via une simple table `_migration_lock` (one-row, advisory
  lock Postgres) — empêche deux pipelines parallèles
- En cas d'échec, le backend en place continue à tourner
- Logs migration séparés des logs runtime → plus simple à debugger

Cons :
- ~10s de latence en plus dans le pipeline pour le job migration
- L'ancien backend continue à tourner pendant la migration : il faut que
  les migrations soient compatibles avec **les deux versions** du backend
  pendant la fenêtre du deploy → c'est le pattern **expand/contract**

### Option C — Migration manuelle SSH

Pros : contrôle total

Cons : dépend d'un humain, pas reproductible, pas adapté au cycle "je push
sur main et c'est en prod". Réservé aux cas exceptionnels (data fix one-off).

## Décision

**Option B** + adoption stricte du pattern **expand/contract** pour les
changements de schéma non-additifs.

### Pattern expand/contract

Pour tout changement de schéma qui n'est pas un simple ajout, on découpe en
**deux migrations consécutives** sur deux deploys distincts.

Exemple : renommer la colonne `users.display_name` en `users.full_name`.

**Migration N (expand)** — déployée en deploy A :
- `ALTER TABLE users ADD COLUMN full_name TEXT`
- `UPDATE users SET full_name = display_name WHERE full_name IS NULL`
- Le code applicatif lit/écrit dans `display_name` (ancienne colonne) ET
  écrit aussi dans `full_name` (nouvelle colonne) — *dual-write*
- `display_name` reste nullable (au cas où une nouvelle ligne arrive avec
  uniquement `full_name`)

**Migration N+1 (contract)** — déployée en deploy B (≥ 1 jour plus tard) :
- Le code applicatif lit/écrit uniquement `full_name`
- `ALTER TABLE users DROP COLUMN display_name`

Bénéfice : à aucun moment le schéma n'est incompatible avec le code en
production. Pas de downtime.

Pour les changements simples (ajout de colonne nullable, ajout d'index
`CONCURRENTLY`, ajout de table), pas besoin d'expand/contract.

### Règles à suivre dans les migrations

| Type de change | Stratégie |
|----------------|-----------|
| Add column nullable | direct, OK |
| Add column NOT NULL avec default | direct, OK |
| Add column NOT NULL sans default | expand/contract (add nullable + backfill + alter NOT NULL) |
| Add index | `CREATE INDEX CONCURRENTLY` (pas de lock table) |
| Add unique constraint | expand/contract (add index unique CONCURRENTLY puis ADD CONSTRAINT USING INDEX) |
| Drop column | expand/contract (deploy code qui ne la lit plus, puis drop) |
| Rename column | expand/contract (add new + dual-write + drop old) |
| Drop table | expand/contract (deploy code qui n'y touche plus, puis drop) |
| Change column type compatible | direct (ex: TEXT → VARCHAR(n)) |
| Change column type incompatible | expand/contract (add new col + backfill + drop old) |

### Lock applicatif

Le job migration acquiert un advisory lock Postgres avant de tourner :
```sql
SELECT pg_advisory_lock(871234567);  -- magic number constant
-- migrations
SELECT pg_advisory_unlock(871234567);
```
Si un autre job tente en parallèle, il bloque jusqu'à libération. Évite
toute corruption sur deploys concurrents (rare mais possible si on push
deux fois rapidement).

### Rollback

**Avant deploy** (migration échoue) :
- Le job retourne ≠ 0 → pipeline abort, pas de swap. L'ancien backend
  continue. On corrige la migration et on repush.

**Après deploy** (migration OK mais le code introduit un bug) :
- `docker compose up -d backend --force-recreate` avec le tag `<sha
  précédent>` → l'ancien code reprend
- **Important** : le schéma est dans l'état post-migration. Si on a suivi
  expand/contract, l'ancien code fonctionne avec le nouveau schéma. Sinon
  → migration de rollback explicite à appliquer, ce qui est la situation
  qu'on essaie d'éviter

**Données mal migrées** :
- Restore depuis le dernier `pg_dump` (cf. ADR-012, backup quotidien)
- Procédure documentée dans `infra/restore.md`
- À tester tous les 3 mois

### Outillage

Drizzle Kit en mode **migration files** (pas mode `db:push`). Workflow dev :
1. Modifier `db/schema/index.ts`
2. `pnpm --filter @nexus/backend db:generate` → génère `drizzle/migrations/000X_<name>.sql`
3. Review humaine de la SQL générée (mandatory : Drizzle Kit ne sait pas
   faire de l'expand/contract automatiquement, à toi de découper si besoin)
4. Commit la migration avec le code

Aucune édition manuelle de migrations déjà mergées sur `main` (immuables).
Pour corriger : on génère une nouvelle migration `000Y_fix_...sql`.

### Au stade MVP

Tant qu'on n'a qu'un seul backend (1 instance) et pas de trafic (beta
privée), on peut occasionnellement se permettre des migrations directes
(non expand/contract) avec un downtime de quelques secondes. **Mais on
adopte la discipline dès maintenant**, parce que :
- Ça force à réfléchir aux transitions
- Ça évite la dette de devoir tout refactorer le jour où on a du trafic
- Les migrations propres sont faciles à reviewer

## Conséquences

**Positives**
- Pas de downtime sur changements simples
- Pas de risque de corruption sur deploys concurrents (advisory lock)
- Logs migration séparés
- Compatible avec un futur scale-out (plusieurs instances backend)

**Négatives / coûts**
- Discipline expand/contract = parfois 2 PR au lieu de 1 pour un changement
  qui aurait été 1 step en mode "casse tout puis répare"
- Backfills sur grosses tables peuvent être lents → à exécuter en batch
  (script Node ad-hoc, pas dans la migration)

**Neutres**
- La table `_migration_lock` n'est pas un objet métier, juste de la
  plomberie. À documenter dans `infra/db.md`.

## Implémentation prévue

Sous-jalon **J3.5** :
- Wrapper script `pnpm db:migrate:prod` qui acquiert l'advisory lock avant
  de déléguer à `drizzle-kit migrate` puis le libère
- Service `migrate` dans `docker-compose.prod.yml` (one-shot, jamais up
  par défaut)
- Doc `infra/db.md` avec les règles expand/contract résumées

## Références

- Pattern expand/contract : Martin Fowler, "Evolutionary Database Design"
  (https://martinfowler.com/articles/evodb.html)
- ADR-002 : choix Drizzle ORM
- ADR-005 : multi-tenant — `groupId` partout, pas de schéma par tenant
- ADR-011 : pipeline CI/CD qui orchestre l'appel
