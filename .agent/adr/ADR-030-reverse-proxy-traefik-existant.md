# ADR-030 : Reverse proxy = Traefik existant (amende ADR-012)

**Date** : 2026-05-07
**Statut** : Accepté
**Amende** : ADR-012 (partiel — section reverse proxy uniquement)

## Contexte

ADR-012 (2026-05-01) tranchait que le reverse proxy de Nexus en prod
serait **Caddy**, pour ses qualités (HTTPS auto, Caddyfile lisible,
WebSocket natif, HTTP/3) et parce qu'on supposait le VPS "vierge" côté
reverse proxy.

L'audit du VPS du 2026-05-07 a révélé une réalité différente :

- Le VPS Hostinger KVM2 a **Traefik déjà installé et opérationnel**
  depuis ~3 mois (uptime 195 jours), en container Docker dans
  `/root/docker-compose.yml`.
- Traefik gère déjà n8n (sous-domaine `n8n.srv1068104.hstgr.cloud`) avec
  Let's Encrypt automatique via TLS-ALPN-01 challenge.
- Provider Docker socket reader configuré
  (`--providers.docker.exposedbydefault=false`), routes via labels.
- Network `root_default` (bridge Docker) auquel tout container peut se
  greffer.

Détails complets dans `.agent/notes/traefik-existing.md`.

## Options envisagées

### Option A — Migrer vers Caddy comme prévu par ADR-012

Désinstaller Traefik (downtime n8n), réinstaller Caddy, réécrire la config
n8n en Caddyfile, regénérer les certificats Let's Encrypt.

Pros :

- Cohérence avec l'ADR initial
- Caddyfile plus lisible que les labels Traefik

Cons :

- **Downtime n8n** garanti pendant la migration (Manu utilise n8n
  quotidiennement pour ses automatisations indépendantes de Nexus)
- Travail "pour rien" — on remplace une stack qui marche depuis 3 mois
- Risque de régression certs (rate limit Let's Encrypt sur reissuance)
- N'apporte aucun bénéfice fonctionnel concret pour Nexus

### Option B — Garder Traefik, greffer Nexus dessus (RETENU)

Le compose Nexus séparé (`/opt/nexus/docker-compose.yml`) rejoint le
network `root_default` en `external: true` et déclare ses routes via
labels Docker. Traefik route automatiquement (via socket reader) sans
modification de la stack n8n existante.

Pros :

- **Zéro perturbation pour n8n** — la stack `/root/docker-compose.yml`
  n'est pas touchée
- Réutilisation du cert resolver existant `mytlschallenge` (Let's Encrypt
  auto pour `nexusapp.chat`)
- Découplage total : compose Nexus indépendant, déployable / rollback-able
  sans impact sur n8n
- Traefik gère WebSocket nativement (équivalent Caddy)
- Pas de migration certs

Cons :

- Labels Docker plus verbeux qu'un Caddyfile pour qui n'a jamais lu de
  Traefik labels — courbe d'apprentissage légère mais documentée
- Reste sur Traefik v2 (pas v3) — l'image utilisée est `traefik:latest`
  (à figer en prod, cf. TODO).
- Pas de HTTP/3 par défaut (vs Caddy) — activable via
  `--entrypoints.websecure.http3=true` (TODO post-V1)

### Option C — 2 reverse proxies cohabitants

Garder Traefik pour n8n, ajouter Caddy pour Nexus, sur ports différents
(par ex. Traefik sur 80/443 actuels, Caddy sur 8080/8443 derrière
Traefik en proxy ?).

Pros :

- Cohérence ADR-012 partielle

Cons :

- Complexité gratuite (2 reverse proxies en même temps)
- Conflits de ports inévitables, hacks à monter pour les contourner
- Aucun intérêt concret

## Décision

**Option B — Garder Traefik existant, greffer Nexus comme stack séparée.**

Le compose Nexus est dans `/opt/nexus/docker-compose.yml` (séparé du
compose root), rejoint le réseau `root_default` en `external: true`. Tous
les services Nexus public-facing (backend Fastify, statics web et landing)
déclarent leurs labels Traefik. Postgres et Redis Nexus restent sur un
réseau dédié `nexus-internal` (`internal: true`) pour isolation.

### Routes Traefik prévues pour Nexus

| Hostname | Match | Backend |
| --- | --- | --- |
| `api.nexusapp.chat` | tout | Backend Fastify (port 3000) |
| `nexusapp.chat` | `/e/*`, `/p/*`, `/d/*`, `/t/*`, `/l/*` | Backend Fastify SSR (cf. ADR-010) |
| `nexusapp.chat` | reste | Static landing (file_server interne) |
| `app.nexusapp.chat` | tout | Static SPA web (file_server interne) |

### Cert resolver

Réutilisation du `mytlschallenge` existant. Les nouveaux hostnames
(`nexusapp.chat`, `app.nexusapp.chat`, `api.nexusapp.chat`) seront
auto-provisionnés au premier hit HTTPS, à condition que les DNS records A
pointent sur l'IPv4 du VPS (`72.61.162.195`).

⚠️ Pré-requis avant le premier deploy : DNS records A pointés sur le VPS,
sinon TLS-ALPN-01 challenge échoue.

### Email Let's Encrypt

L'email actuel `user@srv1068104.hstgr.cloud` (placeholder Hostinger) est à
remplacer par un vrai email Manu pour recevoir les notifications de
renouvellement. Modification dans `/root/docker-compose.yml` (Cmd
Traefik), restart de Traefik, sans impact certs déjà émis. **Tracé en
TODO post-V1**, pas bloquant pour le déploiement initial.

## Ce qui reste valide d'ADR-012

ADR-030 amende **uniquement** la section "reverse proxy" d'ADR-012. Tout
le reste reste applicable :

- Postgres container dédié Nexus (volume `nexus-pgdata`)
- Redis container dédié Nexus (volume `nexus-redis-data`, sur réseau
  `nexus-internal` isolé)
- Workers BullMQ en containers séparés (J3+)
- Backups pg_dump quotidiens vers Object Storage S3-compatible
- Gestion secrets via fichiers (Docker secrets) + `.env.production` mode
  0600
- Capacité prévue (~3 Go RAM avec stack complète Nexus + n8n existant,
  marge ~5 Go sur 8)

ADR-012 reste donc applicable pour tout sauf la mention "Caddy". Le
remplacement Caddy → Traefik se traduit par :

- `Caddyfile` → labels Docker dans `docker-compose.prod.yml`
- Bloc `caddy:` dans le compose → **supprimé** (Traefik existant l'assume)
- Routes définies en YAML labels au lieu de Caddyfile DSL

## Conséquences

### Positives

- **Zéro downtime n8n** lors du déploiement initial Nexus
- Réutilisation infra existante (cert resolver, network bridge)
- Découplage stacks (compose Nexus modifiable sans impact n8n)
- Gain de temps : pas de migration Caddy, pas de regen certs

### Négatives / coûts

- Apprentissage des labels Traefik (équivalent à apprendre un Caddyfile,
  mais syntaxe différente). Documentation officielle complète, et
  squelette validé dans `.agent/notes/traefik-existing.md`.
- Verbosité des labels : ~10-15 labels par service (vs ~5 lignes
  Caddyfile). Cosmétique.
- Couplage indirect au compose root : si quelqu'un touche au network
  `root_default` ou désactive Traefik, Nexus tombe. Mitigation : on
  n'y touche pas, et le compose root est l'install Hostinger officielle.

### Neutres

- Aucun impact sur la qualité de service (Traefik et Caddy sont
  équivalents pour un usage standard reverse proxy + Let's Encrypt +
  WebSocket).
- ADR-012 n'est pas déprécié, juste amendé sur 1 point — il reste la
  référence pour Postgres/Redis/topologie/backups.

## Implémentation

Couvert par les livrables de la tâche `prep code déploiement Nexus`
(2026-05-07) :

- `infra/docker-compose.prod.yml` — compose Nexus séparé avec labels Traefik
- `Dockerfile` (racine) — image backend multi-stage
- `infra/.env.production.example` — template
- `infra/deploy.sh` — pipeline deploy idempotent (pull + migration job +
  swap + healthcheck + rollback)
- `.github/workflows/deploy.yml` — CD pipeline GitHub Actions
- `packages/backend/scripts/migrate-prod.ts` — wrapper migrations avec
  `pg_advisory_lock` (cf. ADR-013)

## TODO post-V1 (durcissement Traefik existant)

Tracé en backlog, à programmer après le launch :

1. Désactiver `--api.insecure=true` (dashboard Traefik exposé sans auth),
   le sécuriser via middleware basic-auth ou IP whitelist
2. Remplacer email Let's Encrypt placeholder par email Manu
3. Activer access logs Traefik (`--accesslog=true`) avec rotation
4. Optionnel : HTTP/3 (`--entrypoints.websecure.http3=true`)
5. Figer la version de l'image Traefik (`traefik:v3.x` au lieu de
   `traefik:latest`)

## Références

- ADR-012 — Topologie VPS prod (amendée par ce document sur la section
  reverse proxy)
- ADR-010 — Killer features via shared links (justifie les pages
  publiques `/e/*`, `/p/*`, etc.)
- ADR-011 — Pipeline CI/CD GHCR → VPS
- ADR-013 — Migrations DB prod (advisory lock)
- `.agent/notes/traefik-existing.md` — audit complet + squelette compose
- `.agent/notes/vps-hostinger.md` — état du VPS post-hardening
