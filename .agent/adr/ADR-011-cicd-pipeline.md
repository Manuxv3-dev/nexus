# ADR-011 : Pipeline CI/CD — GitHub Actions → GHCR → VPS

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

Le projet doit pouvoir être déployé en prod (VPS Hostinger KVM 2) à chaque
merge sur `main`, sans intervention manuelle, sans build sur le VPS lui-même
(les serveurs de prod doivent être minimalistes et exécuter, pas builder).

Contraintes :

- Repo public (Manuxv3-dev/nexus) — pas de secrets dans le code
- VPS unique (pas de cluster), domaine `nexusapp.chat`
- Backend = un container Node ; à terme, workers BullMQ = containers séparés
  (Discord, WhatsApp, Messenger) qu'il faut pouvoir déployer indépendamment
- Migrations DB doivent passer **avant** que le nouveau backend démarre
- Rollback rapide si la nouvelle version est cassée
- Pas de downtime visible pour l'utilisateur (acceptable : ~5s pendant le
  swap, traité en ADR-013 pour les migrations)

## Options envisagées

### Option A — `git pull` + `pnpm build` directement sur le VPS

À chaque deploy, SSH au VPS, `git pull`, `pnpm install`, `pnpm build`, restart.

Pros :

- Zéro infra externe
- Setup trivial

Cons :

- Le VPS doit avoir Node, pnpm, le toolchain TS — surface attaque ↑
- Build ressources sur la machine de prod (la KVM 2 a 8 GB RAM, marginal mais
  une grosse compilation peut faire OOM les services en parallèle)
- Aucune image immuable → impossible de rollback proprement à une version
  passée sans reset le repo
- Pas de cache de build entre deploys
- Difficile de coordonner le moment où Postgres reçoit les migrations

### Option B — GitHub Actions build → GHCR → VPS pull image (RETENU)

Le pipeline build une **image Docker** dans GitHub Actions, la push sur GHCR
(GitHub Container Registry, gratuit pour repos publics), puis SSH au VPS qui
fait juste `docker compose pull && docker compose up -d`.

Pros :

- Images immuables tagguées par SHA → rollback en 1 commande (`docker
compose up -d --force-recreate avec le tag précédent`)
- Le VPS n'a **que** Docker installé (pas de Node, pas de toolchain) →
  surface attaque minimale
- Build cacheable côté CI (cache des layers Docker)
- Cohérent dev → CI → prod : même image partout
- GHCR gratuit pour le repo public, lié naturellement au repo
- Multi-services natif : on peut publier plusieurs images (backend,
  worker-discord, worker-whatsapp...) avec un seul workflow

Cons :

- Complexité initiale du pipeline (mais ADR-établi, écrit une fois)
- Dépendance à GitHub (acceptable, déjà nécessaire pour le code)

### Option C — Plateforme managée (Render, Railway, Fly.io)

Pros :

- Setup zero-config

Cons :

- Vendor lock-in
- Coûte plus cher que le VPS qu'on a déjà
- WebSockets long-lived parfois mal gérés (cf. discussion Hostinger Sites web)
- On perd le contrôle fin sur les workers, les volumes Postgres, le stockage
  bridges (sessions Baileys avec FS persistant)

## Décision

**Option B — GitHub Actions → GHCR → VPS via SSH + `docker compose pull`.**

### Pipeline CI (déjà en place — `ci.yml`)

Sur chaque push (toutes branches) et chaque PR :

- `lint` (ESLint sur tous les packages)
- `typecheck` (`tsc --noEmit` sur tous les packages)
- `test` (Vitest avec services Postgres+Redis)
- `build` (vérifie que tous les packages compilent)

### Pipeline CD (nouveau — `deploy.yml`)

Trigger : push sur `main` (uniquement après que CI passe).

Étapes :

1. **Build image** backend
   - Dockerfile multi-stage (builder Node 22 + final image distroless ou
     `node:22-alpine` slim — ~80 MB)
   - Tags appliqués : `ghcr.io/manuxv3-dev/nexus-backend:sha-<7chars>` ET
     `ghcr.io/manuxv3-dev/nexus-backend:latest`
   - Cache des layers via `actions/cache` ou `docker/build-push-action` cache
2. **Push** sur GHCR avec `GITHUB_TOKEN`
3. **Deploy** :
   - SSH au VPS via clé déposée dans `secrets.VPS_SSH_KEY`
   - `cd /opt/nexus && docker compose pull && ./deploy.sh`
   - `deploy.sh` :
     1. Run job migration (container one-shot avec la nouvelle image qui exécute
        `pnpm --filter @nexus/backend db:migrate`) — sortie 0 obligatoire avant
        de continuer (cf. ADR-013)
     2. `docker compose up -d backend` (recrée le container avec la nouvelle image)
     3. Healthcheck `curl -fsS http://127.0.0.1:3000/api/v1/health` (10 retries,
        backoff). Si KO → `docker compose up -d --force-recreate` avec le tag
        précédent (rollback)
4. **Notification** : commentaire commit GitHub avec le statut deploy + URL
   `https://api.nexusapp.chat/api/v1/health`

### Workers (J3+)

Le même pipeline sera étendu pour publier `nexus-worker-discord`,
`nexus-worker-whatsapp`, etc. Chaque worker a son service dans
`docker-compose.prod.yml`. Le deploy de chaque worker est indépendant
(matrix dans `deploy.yml` par service modifié).

### Secrets requis (à poser dans GitHub repo settings)

- `VPS_HOST` : IP ou hostname du VPS
- `VPS_USER` : utilisateur SSH (ex. `nexus-deploy`, sudoers limité à docker)
- `VPS_SSH_KEY` : clé privée Ed25519, paire publique installée sur le VPS
- `VPS_KNOWN_HOSTS` : empreinte SSH du VPS (anti-MITM)

### Structure repo

```
.github/workflows/
├── ci.yml                  # déjà existant
└── deploy.yml              # NOUVEAU
packages/backend/
└── Dockerfile              # NOUVEAU (multi-stage)
infra/
├── docker-compose.prod.yml # NOUVEAU
└── deploy.sh               # NOUVEAU (sur le VPS, copié à l'init)
```

## Conséquences

**Positives**

- Déploiement reproductible et auditable : chaque deploy = 1 image taguée
  avec le SHA du commit
- Rollback en 1 commande (`docker compose up -d` avec un tag précédent)
- Le VPS reste minimal (Docker + Caddy + n8n existant)
- Workers et backend découplés au niveau deploy
- Pipeline réutilisable pour staging plus tard si besoin (juste un
  `docker-compose.staging.yml` sur un VPS différent ou sous-domaine)

**Négatives / coûts**

- ~1 jour de boulot pour mettre en place (Dockerfile, deploy.yml, config VPS,
  premiers essais)
- Le premier deploy demande un setup manuel sur le VPS (clé SSH, Docker
  installation, Caddy, premier `docker compose pull`)
- Limite GHCR gratuit : 500 GB de bande passante de pull / mois sur repo
  public (largement suffisant — 80 MB image × 30 deploys/mois = 2.4 GB)

**Neutres**

- On reste dans l'écosystème GitHub end-to-end (pas vu comme un risque vu
  qu'on y est déjà pour le code)

## Implémentation prévue

Sous-jalon **J3.5** dans la roadmap (intercalé entre J3 et J4). 2-3 jours :

- Dockerfile multi-stage backend
- Workflow `deploy.yml`
- Config VPS initiale (Docker, user `nexus-deploy`, clé SSH, dossier `/opt/nexus/`)
- Premier deploy de test depuis CI vers `staging` puis `prod`
- Doc opérateur dans `infra/README.md`
