# ADR-012 : Topologie VPS prod — Caddy + backend + workers + Postgres + Redis

**Date** : 2026-05-01
**Statut** : Proposé

## Contexte

Le VPS Hostinger KVM 2 (8 GB RAM, 2 vCPU, 100 GB disk, France/Paris) doit
héberger l'ensemble de la stack Nexus en prod **et** continuer à faire tourner
n8n (déjà installé, à conserver).

Il faut :
- Un reverse proxy HTTPS pour `nexusapp.chat` + sous-domaines
- Le backend Fastify (API + WebSocket)
- Les workers BullMQ (J3+ : Discord, puis Messenger, puis WhatsApp)
- Postgres 16 (données métier, bridges, sessions)
- Redis 7 (cache, pub/sub, queue BullMQ)
- n8n cohabitant
- Backups automatisés (Postgres + sessions bridges)
- Gestion sécurisée des secrets

## Options envisagées

### Reverse proxy : Caddy vs nginx vs Traefik

**Caddy** (RETENU)
- HTTPS auto via Let's Encrypt, zéro config
- Caddyfile très lisible (~10 lignes pour la stack complète)
- WebSocket support natif (`reverse_proxy` gère `Upgrade` correctement)
- HTTP/3 d'office si on veut

**nginx + certbot** : standard, mais syntaxe verbeuse, certbot à entretenir

**Traefik** : excellent en mode container-native (labels Docker), mais
overkill pour un seul VPS, et Caddyfile est plus simple à lire

### Postgres : container vs install native

**Container** (RETENU)
- Cohérent avec le reste de la stack
- Volume Docker persistant + backup script
- Upgrade plus simple (pull une nouvelle image)

**Install native (`apt`)** : plus performant marginalement, mais complique
les backups, l'upgrade, et la cohérence avec dev (où on a déjà Postgres en
container via `docker-compose.dev.yml`)

### Redis : pareil
Container, partagé entre n8n et Nexus serait possible mais on en isole un
dédié Nexus pour ne pas mélanger les bases logiques (`select 0` Nexus,
`select 15` n8n par exemple).

### Sous-domaines

```
nexusapp.chat                    → landing (statique) PUIS web app après launch
nexusapp.chat/e/:slug, /p/:slug, → pages publiques SSR (backend Fastify)
              /d/:slug, /t/:slug,
              /l/:slug
app.nexusapp.chat                → web app (SPA Vite buildée, static)
api.nexusapp.chat                → API REST + WebSocket (backend Fastify)
```

n8n reste sur son hostname actuel (Hostinger lui en a fourni un par défaut).

## Décision

### Topologie

```
Internet
   │
   ▼
[Caddy :443/:80]   reverse proxy + auto-HTTPS Let's Encrypt
   │
   ├─── nexusapp.chat                 → static files /opt/nexus/landing/dist (V0)
   │                                    PUIS proxy backend SSR (post-launch)
   ├─── nexusapp.chat/e|p|d|t|l/*    → proxy http://backend:3000 (pages publiques)
   ├─── app.nexusapp.chat            → static /opt/nexus/web/dist (SPA)
   └─── api.nexusapp.chat            → proxy http://backend:3000 (API + WS)

[backend container]    Node 22 + Fastify   port 3000 (interne)
[worker-discord]       J3+                 (pas de port exposé)
[worker-whatsapp]      J6+                 (pas de port exposé)
[worker-messenger]     J6+                 (pas de port exposé)
[postgres :5432]       volume nexus-pgdata
[redis :6379]          volume nexus-redis-data
[n8n]                  inchangé, reste en place
```

Tous les services Nexus sont dans un **réseau Docker dédié**
(`nexus-internal`). Seul Caddy est exposé sur les ports publics (`80`, `443`).
Postgres et Redis ne sont **pas** accessibles depuis l'extérieur.

### Caddyfile (essentiel)

```caddy
nexusapp.chat {
  # Pages publiques de Nexus — proxy backend
  handle /e/* /p/* /d/* /t/* /l/* {
    reverse_proxy backend:3000
  }

  # Reste : landing statique (V0) puis web app (post-launch via redirect)
  root * /srv/landing
  file_server
}

app.nexusapp.chat {
  root * /srv/webapp
  try_files {path} /index.html      # SPA fallback
  file_server
  encode zstd gzip
}

api.nexusapp.chat {
  reverse_proxy backend:3000 {
    # WebSocket support natif
    header_up Host {host}
    header_up X-Real-IP {remote_host}
  }
}
```

### docker-compose.prod.yml (squelette)

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - caddy-data:/data
      - caddy-config:/config
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/nexus/landing/dist:/srv/landing:ro
      - /opt/nexus/web/dist:/srv/webapp:ro
    networks: [nexus-internal, nexus-public]

  backend:
    image: ghcr.io/manuxv3-dev/nexus-backend:latest
    env_file: /opt/nexus/.env.production
    depends_on: [postgres, redis]
    networks: [nexus-internal]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/v1/health"]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nexus
      POSTGRES_USER_FILE: /run/secrets/pg_user
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    volumes:
      - nexus-pgdata:/var/lib/postgresql/data
    secrets: [pg_user, pg_password]
    networks: [nexus-internal]

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [nexus-redis-data:/data]
    networks: [nexus-internal]

volumes:
  nexus-pgdata:
  nexus-redis-data:
  caddy-data:
  caddy-config:

networks:
  nexus-internal:
    internal: true     # pas d'accès Internet sortant pour les services internes
  nexus-public:        # Caddy seulement

secrets:
  pg_user:
    file: /opt/nexus/secrets/pg_user
  pg_password:
    file: /opt/nexus/secrets/pg_password
```

Note : `nexus-internal: internal: true` empêche backend/Postgres/Redis de
parler à Internet directement. Le backend a besoin de sortir vers les API
externes (Discord, etc., en J3+) → on lui donne une seconde interface
sur un réseau `nexus-egress` qui est non-internal.

### Gestion des secrets

`/opt/nexus/.env.production` (mode 0600, owner `root` ou `nexus-deploy`,
**non commité**) :
```
NODE_ENV=production
JWT_ACCESS_SECRET=<64 hex>
JWT_REFRESH_SECRET=<64 hex>
ENCRYPTION_KEY_BRIDGES=<32 bytes base64>     # pour J3 chiffrement sessions
DATABASE_URL=postgres://nexus:***@postgres:5432/nexus
REDIS_URL=redis://redis:6379
PUBLIC_URL=https://nexusapp.chat
API_URL=https://api.nexusapp.chat
LOG_LEVEL=info
```

Postgres credentials : Docker secrets (fichiers dans
`/opt/nexus/secrets/`) — pas dans `.env`.

### Backups

**Postgres**
- Cron quotidien (3h du matin) : `pg_dump` compressé →
  `/var/backups/nexus/pg-YYYYMMDD.sql.gz`
- Rétention locale : 14 jours
- Rétention distante : J6+, Object Storage (Hostinger ou S3-compatible
  Backblaze B2 — quelques €/mois pour 50 GB)
- Restauration testée tous les 3 mois (manuellement, document `infra/restore.md`)

**Sessions bridges (Baileys / mautrix-meta) — J6+**
- Volumes persistants Docker
- Snapshots tar.gz quotidiens vers le même bucket que Postgres
- Cf. ADR-008 et ADR-009

### Ports publics

Seuls **80** (HTTP→HTTPS redirect par Caddy) et **443** (TCP+UDP pour HTTP/3)
sont ouverts dans le firewall. SSH (22) reste accessible mais avec :
- Auth par clé uniquement (`PasswordAuthentication no`)
- Fail2ban activé
- Accès limité à l'utilisateur `nexus-deploy` (sudoers limité à docker)

### Cohabitation avec n8n

n8n continue de tourner sur son setup actuel (probablement en container
propre, port 5678 ou similaire, hostname Hostinger). On ne touche à rien.

Si conflit de ports : Caddy seul écoute sur 80/443, n8n est sur son port
interne. À court terme, n8n garde son hostname Hostinger ; si on veut le
mettre derrière Caddy aussi, c'est trivial (un bloc `n8n.nexusapp.chat`
dans le Caddyfile).

### Capacité prévue

KVM 2 = 8 GB RAM / 2 vCPU / 100 GB. Estimation MVP :
- Caddy : ~30 MB
- backend : ~150 MB
- worker-discord : ~120 MB (J3+)
- workers WhatsApp/Messenger : ~150 MB chacun (J6+)
- Postgres : 200-500 MB selon la base
- Redis : ~50 MB
- n8n : ~200-400 MB
- **Total estimé MVP** : ~1.5 GB ; **launch + workers** : ~2 GB
- Marge confortable pour Postgres qui grandit + cache OS

CPU : pic au démarrage des bridges et lors de la sync historique. À
monitorer en J7 pour décider d'un éventuel upgrade KVM 4.

## Conséquences

**Positives**
- Stack reproductible (`docker-compose.prod.yml` est la source de vérité)
- Isolation réseau forte (services internes inaccessibles depuis Internet)
- Caddy = HTTPS auto, zéro maintenance certificate
- Backups en place dès le J0 prod
- n8n cohabite proprement, pas de conflit

**Négatives / coûts**
- Premier setup VPS = ~½ jour (installer Docker, créer user `nexus-deploy`,
  configurer firewall, déposer les secrets initiaux)
- Backup distant = Object Storage à payer (~3-5 €/mois Backblaze pour 50 GB)
- Si la base grossit beaucoup (>40 GB), upgrade VPS à prévoir

**Neutres**
- On accepte d'avoir tous les œufs dans le même panier (un seul VPS) — OK
  pour MVP/launch privé. Multi-VPS = post-launch si volumétrie le justifie.

## Implémentation prévue

Sous-jalon **J3.5** (en parallèle d'ADR-011) :
- Setup VPS : Docker, user, firewall (1/2 jour)
- Caddyfile + docker-compose.prod.yml (1/2 jour)
- Premier deploy backend (1/2 jour)
- Cron backup Postgres + test restore (1/2 jour)
