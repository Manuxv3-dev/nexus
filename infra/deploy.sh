#!/usr/bin/env bash
#
# infra/deploy.sh — script de déploiement Nexus exécuté sur le VPS.
#
# Cf. ADR-011 (CI/CD pipeline) + ADR-013 (migrations advisory lock).
#
# Usage :
#   ./deploy.sh <IMAGE_TAG>
#
# Exemples :
#   ./deploy.sh sha-abc1234   # tag SHA spécifique (depuis CI)
#   ./deploy.sh latest        # tag flottant (deploys manuels)
#
# Étapes :
#   1. Pull image
#   2. Démarre Postgres + Redis si pas up, attend healthy
#   3. Job migration one-shot (advisory lock + drizzle-orm migrate)
#   4. Swap backend + workers (force-recreate avec nouvelle image)
#   5. Attend que le backend soit healthy
#   5b. Vérifie que les 3 workers BullMQ tournent (pas de crash-loop)
#   6. Si KO (backend OU un worker) → rollback automatique au tag précédent
#
# Idempotent : peut être relancé sans risque.

set -euo pipefail

IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="docker-compose.yml"

# Conteneurs workers (cf. docker-compose.prod.yml) — noms `container_name`,
# pas les noms de service compose. Pas de HEALTHCHECK Docker dessus (contrairement
# à backend/postgres) : on vérifie donc `State.Status`, pas `State.Health.Status`.
WORKER_CONTAINERS=(nexus-worker-reminders nexus-worker-purge nexus-worker-push-send)

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log "==== Nexus deploy.sh — image_tag=$IMAGE_TAG ===="

# Sanity check — fichiers requis présents
for f in "$COMPOSE_FILE" .env.production secrets/pg_user secrets/pg_password; do
  if [ ! -f "$f" ]; then
    log "ERROR: missing required file: $f"
    exit 1
  fi
done

# Mémorise le tag actuellement en service (pour rollback)
CURRENT_TAG=""
if docker inspect nexus-backend >/dev/null 2>&1; then
  CURRENT_TAG=$(
    docker inspect nexus-backend \
      --format '{{.Config.Image}}' 2>/dev/null \
      | awk -F: '{print $NF}'
  )
fi
log "Currently deployed: ${CURRENT_TAG:-<none>}, target: $IMAGE_TAG"

export IMAGE_TAG

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pull les images requises
# ─────────────────────────────────────────────────────────────────────────────
log "Pulling backend + workers..."
docker compose -f "$COMPOSE_FILE" pull backend worker-reminders worker-purge worker-push-send

# ─────────────────────────────────────────────────────────────────────────────
# 2. Démarre Postgres + Redis si pas déjà up
# ─────────────────────────────────────────────────────────────────────────────
log "Starting Postgres + Redis (idempotent)..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis

log "Waiting for Postgres healthy..."
tries=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' nexus-postgres 2>/dev/null)" = "healthy" ]; do
  tries=$((tries + 1))
  if [ $tries -gt 30 ]; then
    log "ERROR: postgres did not become healthy in ~60s"
    exit 1
  fi
  sleep 2
done
log "Postgres healthy."

# ─────────────────────────────────────────────────────────────────────────────
# 3. Job migration one-shot
# ─────────────────────────────────────────────────────────────────────────────
log "Running database migrations (advisory lock + drizzle)..."
if ! docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
    backend node dist/scripts/migrate-prod.js; then
  log "ERROR: migrations failed. ABORTING. Previous backend still running."
  exit 1
fi
log "Migrations applied."

# ─────────────────────────────────────────────────────────────────────────────
# 4. Swap backend + workers (force-recreate avec nouvelle image)
# ─────────────────────────────────────────────────────────────────────────────
log "Recreating backend + workers with new image..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate \
  backend worker-reminders worker-purge worker-push-send

# 4b. Démarre les services static (idempotent — pas de --force-recreate :
# les Caddyfiles bind-mount, les statics rsync sont déjà à jour)
log "Ensuring static-web + static-landing are up..."
docker compose -f "$COMPOSE_FILE" up -d static-web static-landing

# ─────────────────────────────────────────────────────────────────────────────
# 5. Healthcheck post-swap
# ─────────────────────────────────────────────────────────────────────────────
log "Waiting for backend healthy..."
tries=0
healthy=false
until [ "$(docker inspect -f '{{.State.Health.Status}}' nexus-backend 2>/dev/null)" = "healthy" ]; do
  tries=$((tries + 1))
  if [ $tries -gt 30 ]; then
    log "ERROR: backend did not become healthy in ~60s"
    break
  fi
  sleep 2
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' nexus-backend 2>/dev/null)" = "healthy" ]; then
  healthy=true
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5b. Vérifie que les workers tournent (pas de crash-loop silencieux)
# ─────────────────────────────────────────────────────────────────────────────
# Seule la santé du backend était vérifiée jusqu'ici : un worker en
# crash-loop laissait les jobs s'accumuler sans jamais faire échouer le
# déploiement. Pas de HEALTHCHECK Docker sur ces conteneurs (cf. déclaration
# de WORKER_CONTAINERS) : "running" en continu sur la fenêtre de poll est le
# signal le plus proche qu'on ait d'un crash-loop (qui repasse par
# "restarting"/"exited" entre 2 tentatives de Docker).
if [ "$healthy" = "true" ]; then
  log "Checking workers are running..."
  tries=0
  workers_ok=false
  while [ $tries -lt 15 ]; do
    all_running=true
    for w in "${WORKER_CONTAINERS[@]}"; do
      status="$(docker inspect -f '{{.State.Status}}' "$w" 2>/dev/null || true)"
      if [ "$status" != "running" ]; then
        all_running=false
      fi
    done
    if [ "$all_running" = "true" ]; then
      workers_ok=true
      break
    fi
    tries=$((tries + 1))
    sleep 2
  done

  if [ "$workers_ok" != "true" ]; then
    healthy=false
    log "ERROR: at least one worker is not running after ~30s"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Rollback si KO
# ─────────────────────────────────────────────────────────────────────────────
if [ "$healthy" != "true" ]; then
  log "Last 30 lines of backend logs:"
  docker logs --tail 30 nexus-backend || true

  for w in "${WORKER_CONTAINERS[@]}"; do
    status="$(docker inspect -f '{{.State.Status}}' "$w" 2>/dev/null || true)"
    if [ "$status" != "running" ]; then
      log "Last 30 lines of $w logs (status=${status:-<absent>}):"
      docker logs --tail 30 "$w" || true
    fi
  done

  if [ -n "$CURRENT_TAG" ] && [ "$CURRENT_TAG" != "$IMAGE_TAG" ]; then
    log "Rolling back to previous tag: $CURRENT_TAG"
    IMAGE_TAG="$CURRENT_TAG" docker compose -f "$COMPOSE_FILE" up -d --force-recreate \
      backend worker-reminders worker-purge worker-push-send

    rollback_tries=0
    until [ "$(docker inspect -f '{{.State.Health.Status}}' nexus-backend 2>/dev/null)" = "healthy" ]; do
      rollback_tries=$((rollback_tries + 1))
      if [ $rollback_tries -gt 30 ]; then
        log "FATAL: rollback also failed health check. Manual intervention required."
        exit 2
      fi
      sleep 2
    done
    log "Rollback successful. Backend on: $CURRENT_TAG"
    exit 1
  else
    log "FATAL: no previous tag known for rollback. Manual intervention required."
    exit 2
  fi
fi

log "==== Deploy SUCCESS — backend on $IMAGE_TAG ===="
