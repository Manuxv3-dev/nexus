# `infra/` — Configurations de déploiement Nexus

Ce dossier contient les fichiers d'infrastructure de production de Nexus.
Ils sont **versionnés dans le repo** mais **les secrets** (env values
réels, fichiers de credentials Postgres) sont **uniquement sur le VPS
dans `/opt/nexus/`** et jamais commités.

## Contenu

```
infra/
├── README.md                       # ce fichier
├── docker-compose.prod.yml         # stack prod (backend + Postgres + Redis + statics)
├── .env.production.example         # template des variables d'env (à copier sur le VPS)
├── deploy.sh                       # script de déploiement (exécuté côté VPS)
├── db.md                           # règles migrations prod + advisory lock
└── restore.md                      # procédure de restore pg_dump
```

## Architecture

Cf. ADR-012 (topologie VPS prod) et ADR-030 (Traefik au lieu de Caddy).

Résumé :

- Le compose Nexus est dans `/opt/nexus/docker-compose.yml` sur le VPS
  (copié depuis `infra/docker-compose.prod.yml` au moment du provisioning).
- Il est **séparé** du compose Hostinger (`/root/docker-compose.yml`) qui
  héberge Traefik + n8n.
- Il rejoint le réseau `root_default` en `external: true` pour que Traefik
  route vers le backend Nexus via labels Docker.
- Postgres et Redis Nexus sont sur un réseau dédié `nexus-internal`
  (`internal: true`), aucun accès Internet sortant pour ces services.

```
┌──────────────────────────────────────────────────────────────┐
│ /root/docker-compose.yml  (existant Hostinger, intouchable)   │
│  ┌──────────┐    ┌──────┐                                     │
│  │ traefik  │────│ n8n  │   network: root_default             │
│  └──────────┘    └──────┘                                     │
│       │                                                       │
└───────┼───────────────────────────────────────────────────────┘
        │ partage le network root_default (external: true)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ /opt/nexus/docker-compose.yml  (notre stack)                  │
│                                                               │
│  ┌─────────┐                                                  │
│  │ backend │   labels traefik.* — routé sur api.nexusapp.chat │
│  │ Fastify │   network: root_default + nexus-internal         │
│  └────┬────┘                                                  │
│       │                                                       │
│   ┌───┴────────────────┐                                      │
│   ▼                    ▼      network: nexus-internal         │
│ ┌──────────┐    ┌────────┐   (internal: true, isolé)          │
│ │ postgres │    │ redis  │                                    │
│ └──────────┘    └────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

## Workflow de déploiement

1. Push sur `main` côté GitHub
2. Workflow CI (`.github/workflows/ci.yml`) lance lint + typecheck + test + build
3. Si CI vert, workflow CD (`.github/workflows/deploy.yml`) :
   - Build l'image Docker via `Dockerfile` (à la racine, multi-stage)
   - Push sur GHCR (`ghcr.io/manuxv3-dev/nexus-backend:sha-<7chars>`)
   - SSH au VPS (`nexus@72.61.162.195:2222`)
   - Exécute `cd /opt/nexus && ./deploy.sh sha-<7chars>`
4. `deploy.sh` :
   - Pull la nouvelle image
   - Job migration one-shot (advisory lock + drizzle-kit migrate)
   - Si migration KO → abort, pas de swap
   - Si migration OK → `docker compose up -d backend` (recrée container)
   - Healthcheck `/api/v1/health`, rollback si KO

## Provisioning initial du VPS

À faire une seule fois, après le hardening (cf.
`.agent/notes/vps-hostinger.md`) :

```bash
# Sur le VPS, en tant que nexus
sudo mkdir -p /opt/nexus/secrets
sudo chown -R nexus:nexus /opt/nexus
cd /opt/nexus

# Copie le compose et le script de deploy depuis le repo
# (pour la phase 1 manuelle, avant que le pipeline CD soit en place)
scp -P 2222 infra/docker-compose.prod.yml nexus@72.61.162.195:/opt/nexus/docker-compose.yml
scp -P 2222 infra/deploy.sh                nexus@72.61.162.195:/opt/nexus/deploy.sh
scp -P 2222 infra/.env.production.example  nexus@72.61.162.195:/opt/nexus/.env.production.example

# Sur le VPS, configure les secrets
chmod +x /opt/nexus/deploy.sh
cp .env.production.example .env.production
chmod 0600 .env.production
nano .env.production    # remplir les vrais secrets

# Postgres credentials (Docker secrets)
echo -n "nexus" > secrets/pg_user
openssl rand -base64 32 > secrets/pg_password
chmod 0600 secrets/*

# Premier pull + boot
docker compose pull
./deploy.sh latest    # ou un tag SHA spécifique
```

Détails : voir [ADR-011](../.agent/adr/ADR-011-cicd-pipeline.md) et
[ADR-012](../.agent/adr/ADR-012-vps-prod-topology.md).

## Secrets & gestion d'env

- **`.env.production`** : valeurs en clair des variables d'env, mode 0600,
  owner `nexus`, **non commité**. Source de vérité = ce fichier sur le
  VPS, pas le repo.
- **`secrets/pg_user`, `secrets/pg_password`** : credentials Postgres,
  montés en Docker secrets (`/run/secrets/`). Mode 0600, owner `nexus`,
  jamais commités.
- Toute nouvelle variable doit être ajoutée :
  - Dans `infra/.env.production.example` (template, commité, sans valeur)
  - Dans `.env.production` côté VPS (manuellement)
  - Dans `packages/backend/src/core/env.ts` (validation Zod)

## Liens

- [ADR-011 — CI/CD pipeline](../.agent/adr/ADR-011-cicd-pipeline.md)
- [ADR-012 — Topologie VPS prod](../.agent/adr/ADR-012-vps-prod-topology.md)
- [ADR-013 — Migrations DB prod](../.agent/adr/ADR-013-db-migrations-prod.md)
- [ADR-030 — Reverse proxy Traefik](../.agent/adr/ADR-030-reverse-proxy-traefik-existant.md)
- [Note état VPS](../.agent/notes/vps-hostinger.md)
- [Note Traefik existant](../.agent/notes/traefik-existing.md)
