# Traefik existant sur le VPS — état + stratégie de greffe Nexus

**Date audit** : 2026-05-07
**Source** : `docker inspect root-traefik-1` + `/root/docker-compose.yml`

## Stack actuelle

```
NAMES            IMAGE     PORTS                                      ROLE
root-traefik-1   traefik   0.0.0.0:80→80, 0.0.0.0:443→443             Reverse proxy + LE
root-n8n-1       n8n       127.0.0.1:5678→5678                        Workflow automation
```

Compose path : **`/root/docker-compose.yml`** (Manu **ne touche pas** —
c'est l'install Hostinger d'origine, modifier risquerait de casser n8n).

## Configuration Traefik

```
--api=true
--api.insecure=true              ⚠️ dashboard sans auth, à durcir post-V1
--providers.docker=true
--providers.docker.exposedbydefault=false  ✅ seuls les containers avec traefik.enable=true sont routés
--entrypoints.web.address=:80
--entrypoints.web.http.redirections.entryPoint.to=websecure   ✅ redirect 80→443
--entrypoints.websecure.address=:443
--certificatesresolvers.mytlschallenge.acme.tlschallenge=true
--certificatesresolvers.mytlschallenge.acme.email=user@srv1068104.hstgr.cloud  ⚠️ placeholder
--certificatesresolvers.mytlschallenge.acme.storage=/letsencrypt/acme.json
```

**Mounts Traefik** :

- Volume `traefik_data` → `/letsencrypt` (acme.json y vit)
- `/var/run/docker.sock` (lecture labels containers)

**Network** : `root_default` (bridge créé par le compose root).

**Cert resolver** : `mytlschallenge` — TLS-ALPN-01 challenge sur port 443.
Compatible avec n'importe quel domaine pointé sur le VPS, pas besoin de
DNS-01.

## Greffe Nexus — stratégie validée

**Approche** : compose Nexus **séparé** dans `/opt/nexus/docker-compose.yml`
qui rejoint le réseau `root_default` en `external: true`. Découplage total
de la stack n8n (modifications du compose Nexus n'impactent jamais n8n).

### Squelette compose Nexus

```yaml
services:
  backend:
    image: ghcr.io/manuxv3-dev/nexus-backend:latest
    env_file: /opt/nexus/.env.production
    networks: [root_default, nexus-internal]
    depends_on: [postgres, redis]
    restart: unless-stopped
    labels:
      - 'traefik.enable=true'
      - 'traefik.docker.network=root_default'
      - 'traefik.http.routers.nexus-api.rule=Host(`api.nexusapp.chat`)'
      - 'traefik.http.routers.nexus-api.entrypoints=web,websecure'
      - 'traefik.http.routers.nexus-api.tls=true'
      - 'traefik.http.routers.nexus-api.tls.certresolver=mytlschallenge'
      - 'traefik.http.routers.nexus-api.middlewares=nexus-secure-headers@docker'
      - 'traefik.http.middlewares.nexus-secure-headers.headers.STSSeconds=315360000'
      - 'traefik.http.middlewares.nexus-secure-headers.headers.browserXSSFilter=true'
      - 'traefik.http.middlewares.nexus-secure-headers.headers.contentTypeNosniff=true'
      - 'traefik.http.services.nexus-api.loadbalancer.server.port=3000'
      # Pages publiques (e/p/d/t/l) sur nexusapp.chat
      - 'traefik.http.routers.nexus-public.rule=Host(`nexusapp.chat`) && (PathPrefix(`/e/`) || PathPrefix(`/p/`) || PathPrefix(`/d/`) || PathPrefix(`/t/`) || PathPrefix(`/l/`))'
      - 'traefik.http.routers.nexus-public.entrypoints=web,websecure'
      - 'traefik.http.routers.nexus-public.tls=true'
      - 'traefik.http.routers.nexus-public.tls.certresolver=mytlschallenge'
      - 'traefik.http.routers.nexus-public.service=nexus-api'

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nexus
      POSTGRES_USER_FILE: /run/secrets/pg_user
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    volumes:
      - nexus-pgdata:/var/lib/postgresql/data
    secrets: [pg_user, pg_password]
    networks: [nexus-internal] # ⚠️ pas root_default — Postgres n'est PAS publié

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [nexus-redis-data:/data]
    networks: [nexus-internal] # ⚠️ pas root_default — Redis n'est PAS publié

  # Statics (landing + web) servis par caddy/file_server interne (ou nginx léger)
  # à arbitrer en session prep code

volumes:
  nexus-pgdata:
  nexus-redis-data:

networks:
  root_default:
    external: true
  nexus-internal:
    internal: true # pas d'accès Internet sortant pour les services métier
```

### Pourquoi 2 networks ?

- **`root_default`** : partagé avec Traefik, permet à Traefik de router
  vers le backend. Backend est dessus pour être atteignable.
- **`nexus-internal`** (avec `internal: true`) : Postgres + Redis y sont
  isolés. Backend les contacte via ce réseau (il a 2 interfaces). Aucun
  accès Internet sortant pour Postgres/Redis (sécurité).

⚠️ Note Docker network : `traefik.docker.network=root_default` est
**obligatoire** dans les labels du backend, sinon Traefik ne sait pas via
quelle interface du container il doit envoyer le traffic (le backend a 2
interfaces).

## Routes Traefik prévues pour Nexus

| Hostname            | Match                                  | Backend                           |
| ------------------- | -------------------------------------- | --------------------------------- |
| `api.nexusapp.chat` | tout                                   | Backend Fastify (port 3000)       |
| `nexusapp.chat`     | `/e/*`, `/p/*`, `/d/*`, `/t/*`, `/l/*` | Backend Fastify SSR (cf. ADR-010) |
| `nexusapp.chat`     | reste                                  | Static landing (file server)      |
| `app.nexusapp.chat` | tout                                   | Static SPA web (file server)      |

## TODO post-V1 — durcissement Traefik

**Runbook exécutable : `.agent/notes/man-20-traefik-vps-hardening-runbook.md`
(MAN-20).**

Sans bloquer le déploiement V1 :

1. Désactiver `--api.insecure=true`, exposer dashboard avec auth
   basic-auth via middleware
2. Remplacer email Let's Encrypt placeholder par vrai email (notifs
   renouvellement)
3. Activer access logs Traefik (`--accesslog=true`) avec rotation
4. Optionnel : passer en HTTP/3 (`--entrypoints.websecure.http3=true`)

## Réf

- ADR-012 (à amender via ADR-030) — choix initial Caddy, remplacé par
  Traefik vu l'existant
- ADR-011 — pipeline CD qui déploie le backend via `docker compose pull`
  dans `/opt/nexus`
