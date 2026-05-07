# `infra/db.md` — Migrations & Backup/Restore

Cf. ADR-013 (migrations DB en prod) + ADR-012 (backups).

## Migrations en production

### Pattern expand/contract

Pour tout changement de schéma non-additif, **2 migrations consécutives**
sur deux deploys distincts :

1. **N (expand)** : ajoute la nouvelle structure, code applicatif fait
   du dual-write. Ancienne structure conservée.
2. **N+1 (contract)** : code applicatif lit/écrit uniquement la nouvelle.
   Drop ancienne structure.

Bénéfice : pas de downtime, schéma compatible avec les deux versions du
code pendant la fenêtre du deploy.

### Règles à suivre

| Type de change | Stratégie |
| --- | --- |
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

### Workflow ajouter une migration

```bash
# 1. Modifier le schéma TS
# packages/backend/src/db/schema/index.ts

# 2. Générer la migration SQL
pnpm --filter @nexus/backend db:generate

# 3. Review humaine du SQL généré
# packages/backend/drizzle/migrations/00XX_<name>.sql

# 4. Si expand/contract : découper manuellement en 2 migrations
#    drizzle-kit ne sait pas faire cette découpe automatiquement

# 5. Tester en local
pnpm --filter @nexus/backend db:migrate

# 6. Commit + PR + merge sur main
# Le pipeline CD lance automatiquement migrate-prod sur le VPS
```

### Advisory lock (mutex deploy)

Le wrapper `packages/backend/src/scripts/migrate-prod.ts` acquiert un
**Postgres advisory lock** (`pg_advisory_lock(871234567)`) avant
d'exécuter les migrations. Si un autre deploy tourne en parallèle (rare
mais possible si on push 2 fois rapidement), il bloque jusqu'à libération.

```sql
SELECT pg_advisory_lock(871234567);
-- Migrations exécutées par drizzle-orm/postgres-js/migrator
SELECT pg_advisory_unlock(871234567);
```

Lock libéré automatiquement à la fermeture de la connexion (filet de
sécurité si le process crash entre les deux SELECT).

### Aucune édition manuelle de migrations mergées

Les migrations dans `drizzle/migrations/` mergées sur `main` sont
**immuables**. Pour corriger : on génère une nouvelle migration
`00XX_fix_*.sql`. Jamais éditer un fichier déjà appliqué en prod.

## Backups

### Backup pg_dump quotidien

⚠️ **À mettre en place avant le launch V1**. Procédure prévue :

1. **Cron sur le VPS** (3h00 UTC, peu de trafic) :
   ```bash
   # /etc/cron.daily/nexus-pg-backup
   #!/bin/bash
   set -euo pipefail
   BACKUP_DIR=/var/backups/nexus
   mkdir -p "$BACKUP_DIR"
   docker exec nexus-postgres pg_dump -U nexus -d nexus -Fc \
     | gzip > "$BACKUP_DIR/pg-$(date -u +%Y%m%d-%H%M).dump.gz"
   # Rétention locale 14 jours
   find "$BACKUP_DIR" -name "pg-*.dump.gz" -mtime +14 -delete
   ```

2. **Off-site** (Backblaze B2 ou Cloudflare R2, ~5 €/an pour 50 GB) :
   ```bash
   # Push journalier vers le bucket
   rclone sync /var/backups/nexus/ backblaze:nexus-backups/
   ```

3. **Test de restore** tous les 3 mois (procédure ci-dessous).

Volume Postgres : `nexus-pgdata` (Docker named volume), localisé dans
`/var/lib/docker/volumes/nexus-pgdata/_data` sur le VPS.

### Procédure de restore (en cas de corruption / data loss)

⚠️ **À tester périodiquement** sur un environnement de test, pas en prod.

```bash
# Sur le VPS
cd /opt/nexus

# 1. Stopper le backend pour éviter écritures concurrentes
docker compose stop backend worker-reminders worker-purge

# 2. Choisir le dump à restorer
DUMP=/var/backups/nexus/pg-20260301-0300.dump.gz

# 3. Drop + recreate la base (DESTRUCTIF)
docker exec -i nexus-postgres psql -U nexus -d postgres <<SQL
DROP DATABASE IF EXISTS nexus;
CREATE DATABASE nexus;
SQL

# 4. Restaurer le dump
gunzip -c "$DUMP" | docker exec -i nexus-postgres pg_restore \
  -U nexus -d nexus --no-owner --no-privileges

# 5. Vérifier la cohérence (compter les lignes principales)
docker exec nexus-postgres psql -U nexus -d nexus -c \
  "SELECT 'users' AS t, COUNT(*) FROM users
   UNION ALL SELECT 'groups', COUNT(*) FROM groups
   UNION ALL SELECT 'events', COUNT(*) FROM events;"

# 6. Redémarrer le backend
docker compose up -d backend worker-reminders worker-purge

# 7. Vérifier health
curl -fsS http://127.0.0.1:3000/api/v1/health
```

**Si restore depuis un dump distant (Backblaze B2)** :

```bash
# Avant l'étape 4
rclone copy backblaze:nexus-backups/pg-20260301-0300.dump.gz \
  /var/backups/nexus/
```

### Snapshots Hostinger (filet de sécurité OS-level)

En complément du backup applicatif `pg_dump`, le panel Hostinger fournit
des snapshots de tout le VPS. Ils sont rapides à restaurer (quelques
clics) et permettent de revenir à un état antérieur de **toute la machine**
(OS + Docker + volumes + config).

À utiliser en cas de :
- Corruption massive du VPS (filesystem, kernel)
- Erreur de manipulation système (rm -rf intempestif)
- Compromission (rollback à un état pré-incident)

⚠️ Un snapshot Hostinger ne remplace pas un backup pg_dump :
- Les snapshots sont stockés sur Hostinger (single point of failure)
- Pas de granularité fine (on revient à un état complet, pas une
  table)

Dernier snapshot connu : `nexus-vps-post-hardening-2026-05-07` (à
confirmer côté Manu).

## TODO post-V1

- [ ] Setup cron pg_dump quotidien + rétention locale 14j
- [ ] Bucket S3-compatible (Backblaze B2 ou Cloudflare R2) + sync
- [ ] Test de restore en environnement de test (procédure validée)
- [ ] Alerting sur échec backup (mail Manu si pg_dump non exécuté > 25h)
