# Tâche en cours

**Dernière session** : 2026-05-07 (hardening VPS + prep code + 1er deploy réussi) — clôturée 🟢🚀
**Statut repo** : prep code mergée sur `main`, pipeline CI/CD opérationnel
**Statut VPS** : hardening complet, **stack Nexus en prod**
**URL backend** : https://api.nexusapp.chat (cert Let's Encrypt valide via Traefik)

## 🎉 Session 2026-05-07 — bilan

3h30 de session, 3 phases :

1. **Hardening VPS** (1h30) — port SSH 2222, root login off, UFW, fail2ban,
   unattended-upgrades, kernel à jour, reboot validé. 4 pièges Ubuntu 24.04
   / Hostinger documentés.
2. **Prep code** (1h) — ADR-030 (Traefik), Dockerfile multi-stage,
   compose prod, deploy.sh, workflow CD, wrapper migrate-prod, adaptations
   monorepo (shared exports → dist, drizzle-kit en deps).
3. **Premier deploy effectif** (1h, dont 45 min de debug pipeline) —
   pipeline CD bout en bout, 5 itérations de fix avant succès :
   - 1ère erreur : `ssh-keyscan` Windows (KEX post-quantique non supporté)
     → solution : récupérer keys depuis le VPS
   - 2e erreur : passphrase sur la clé SSH personnelle de Manu
     → solution : clé CI dédiée sans passphrase + ajout en authorized_keys
   - 3e erreur : user `nexus` pas dans groupe docker
     → solution : `sudo usermod -aG docker nexus` (durcissable post-V1
     en user `nexus-deploy` avec NOPASSWD ciblé)
   - 4e itération : remplacement `echo $SECRET > id_ed25519` par action
     standard `webfactory/ssh-agent@v0.9.0`
   - Final : Build & push image (46s) → Sync infra (18s) → Deploy on VPS
     (39s) → Total Success en 2m 6s

## ✅ État live de la prod

```
URL backend         : https://api.nexusapp.chat/api/v1/health
URL pages publiques : https://nexusapp.chat/{e,p,d,t,l}/<slug>
Cert TLS            : Let's Encrypt via Traefik (mytlschallenge,
                      réutilisé du compose root Hostinger)
DB                  : Postgres 16 (volume nexus-pgdata, 14 migrations
                      appliquées)
Cache/queues        : Redis 7 (volume nexus-redis-data, internal-only)
Workers BullMQ      : nexus-worker-reminders + nexus-worker-purge
Image courante      : ghcr.io/manuxv3-dev/nexus-backend:sha-a2b4aab
                      + tag :latest
n8n                 : intact, toujours sur n8n.srv1068104.hstgr.cloud
```

## 🚀 Reprise — prochaines sessions

## 📦 Workflow merge / deploy actuel (en place)

Tu push sur `main` (avec touches dans `packages/backend/**`,
`packages/shared/**`, `Dockerfile`, `infra/**`, `pnpm-lock.yaml`,
`package.json`, `turbo.json`, `tsconfig.base.json`,
`.github/workflows/deploy.yml`) → workflow `deploy.yml` se déclenche
automatiquement et fait :

1. Build image multi-stage → push GHCR avec tags `sha-<7chars>` + `latest`
2. SCP `infra/docker-compose.prod.yml` + `deploy.sh` + `.env.production.example`
   vers `/opt/nexus/` (le `.env.production` réel et les `secrets/*` ne
   sont pas écrasés)
3. SSH au VPS et lance `./deploy.sh sha-<7chars>` → pull image, démarre
   pg + redis si pas up, job migration avec advisory lock, swap backend,
   healthcheck, rollback si KO
4. Healthcheck externe `https://api.nexusapp.chat/api/v1/health`

Pour redéployer manuellement avec un tag spécifique : **GitHub Actions →
deploy → Run workflow** avec input `image_tag` (ex: `sha-abcdefg` ou
`latest`).

## --- ARCHIVES post-mortem (avant le 1er deploy) ---

### ⚠️ AVANT DE COMMIT — checks locaux à passer

Mes modifs sur `packages/shared/package.json` (exports → dist) et
`turbo.json` (dev dependsOn ^build) changent légèrement le workflow
local. Avant de push :

```powershell
cd C:\Users\Manu\claude\nexus\nexus

# 1. Install (pour packager le mouvement drizzle-kit dev → deps)
pnpm install

# 2. Build full (requis avant le premier dev/test après mes modifs sur shared)
pnpm build

# 3. Vérifs CI-like
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check

# 4. Si tout vert : commit + push
git add .
git commit -m "feat(infra): prep code déploiement Nexus (Dockerfile, compose prod, deploy.yml)

- ADR-030 : amende ADR-012, Traefik retenu (existant VPS) au lieu de Caddy
- Dockerfile multi-stage backend (node:22-alpine, ~150-250 MB)
- .dockerignore + monorepo build context
- infra/docker-compose.prod.yml (greffe sur Traefik root_default external)
- infra/.env.production.example + infra/secrets/.gitkeep
- infra/deploy.sh idempotent (advisory lock + healthcheck + rollback)
- infra/db.md (règles migrations + procédure restore)
- .github/workflows/deploy.yml (build → GHCR → SSH deploy + sync infra)
- packages/backend/scripts/migrate-prod.ts (advisory lock pg)
- packages/shared : ajoute build script + dev (tsc -w), exports → dist
- packages/backend : drizzle-kit déplacé en deps (besoin en prod)
- turbo.json : dev dependsOn ^build (build shared avant le watch)"
git push
```

⚠️ Le workflow `deploy.yml` va se déclencher au push sur main mais
**échouera** (secrets GitHub pas encore configurés). C'est attendu.
L'erreur sert de rappel pour configurer les secrets avant le premier
deploy réel.

## 🚀 Reprise — sessions à venir

### Pré-prod (côté Manu, pas de code à attendre)

1. ✅ ~~**Hardening VPS Hostinger**~~ — fait 2026-05-07
2. ⏳ **Snapshot Hostinger post-hardening** — à confirmer (panel Hostinger)
3. ⏳ **DNS records nexusapp.chat** — à configurer (3 records A vers
   `72.61.162.195`)
4. ⏳ **Configurer secrets GitHub** pour le workflow deploy.yml (cf. ci-dessous)

### Configuration GitHub secrets (avant 1er deploy réel)

Aller dans **GitHub repo → Settings → Secrets and variables → Actions**
et créer ces secrets :

| Secret | Valeur |
| --- | --- |
| `VPS_HOST` | `72.61.162.195` |
| `VPS_USER` | `nexus` |
| `VPS_SSH_PORT` | `2222` |
| `VPS_SSH_KEY` | Contenu de `~/.ssh/nexus_vps` (la clé privée Ed25519) |
| `VPS_KNOWN_HOSTS` | Output de `ssh-keyscan -p 2222 72.61.162.195` |

⚠️ Pour le secret `VPS_SSH_KEY`, **c'est la clé privée** (pas la `.pub`).
Format complet incluant `-----BEGIN OPENSSH PRIVATE KEY-----` jusqu'à
`-----END OPENSSH PRIVATE KEY-----`.

⚠️ `VPS_KNOWN_HOSTS` empêche le MITM côté CI. Génération depuis ta
machine Windows :

```powershell
ssh-keyscan -p 2222 72.61.162.195
```

Copier le résultat complet (1-3 lignes selon les algorithmes).

### Provisionnement initial du VPS (avant 1er deploy réel)

À faire **une seule fois**, après que les modifs prep code soient sur
`main` :

```bash
# Sur le VPS, en tant que nexus
sudo mkdir -p /opt/nexus/secrets
sudo chown -R nexus:nexus /opt/nexus

# Pull les fichiers infra depuis le repo (1ère fois uniquement)
cd /tmp
git clone https://github.com/Manuxv3-dev/nexus.git
cp /tmp/nexus/infra/docker-compose.prod.yml /opt/nexus/docker-compose.yml
cp /tmp/nexus/infra/deploy.sh                /opt/nexus/deploy.sh
cp /tmp/nexus/infra/.env.production.example  /opt/nexus/.env.production.example
chmod +x /opt/nexus/deploy.sh
rm -rf /tmp/nexus

# Configure le .env.production avec les vraies valeurs
cd /opt/nexus
cp .env.production.example .env.production
chmod 0600 .env.production
nano .env.production    # remplir DATABASE_URL, JWT secrets, etc.

# Postgres credentials (Docker secrets)
echo -n "nexus" > secrets/pg_user
openssl rand -base64 32 > secrets/pg_password
chmod 0600 secrets/*

# Login GHCR pour pull image privée si besoin (publique → pas requis)
# echo $GHCR_TOKEN | docker login ghcr.io -u <user> --password-stdin

# Premier deploy manuel (avant que CI prenne le relais)
docker compose pull
./deploy.sh latest
```

### Premier deploy via CI

Une fois GitHub secrets configurés + provisionnement initial OK, n'importe
quel push sur `main` (touchant `packages/backend/`, `packages/shared/`,
`Dockerfile`, `infra/`...) déclenche un deploy automatique.

Manuel possible via **GitHub repo → Actions → deploy → Run workflow** avec
un tag spécifique.

### Quick wins UI (sessions courtes, ~30-60 min chacune)

5. **Validation visuelle Tauri post-Bloc-E** — lancer `pnpm tauri:dev`
   et vérifier la timeline d'activité.
6. **Externalisation logo pro** (optionnel V1 public) — Fiverr/Upwork
   ~50-300 €.

### Chantiers structurants

7. **Politique de logs prod** (J9 prep) — `.agent/notes/logs-policy.md`
   + appliquer à pino + workers.
8. **ADR-031 — Purge périodique** notifications + activity_log (worker
   BullMQ nocturne, rétention 30j notifs).
9. **Backup pg_dump quotidien** — bucket S3-compatible (Backblaze B2 ou
   Cloudflare R2). Procédure dans `infra/db.md`.

### TODO post-V1 — durcissement Traefik (cf. `.agent/notes/traefik-existing.md`)

- Désactiver `--api.insecure=true`, basic-auth middleware sur dashboard
- Remplacer email LE placeholder par vrai email Manu
- Access logs Traefik avec rotation
- Optionnel HTTP/3
- Figer image Traefik (`traefik:v3.x` au lieu de `latest`)

### Idées pour plus tard (V1.x — pas urgent)

- Logos colored=true dans Settings (actuellement monochrome)
- Pre-commit hook husky/lefthook (`prettier --write` auto sur staged)
- 112 warnings lint résiduels
- Dette `useEvents/useExpenses/...` côté front : `!` non-null assertions
  à typer proprement
- Container `redis` orphelin du compose root post-reboot 2026-05-07 — à
  investiguer (pas critique, on aura notre Redis dédié)
- Long terme — blindage cloud-init via
  `/etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg`

---

## 📚 Session 2026-05-07 — Récap complet (deux blocs livrés)

### Bloc 1 — Hardening VPS (1h30)

✅ **Audit VPS complet** — services, ports, Docker, reverse proxy
(Traefik existant), ressources

✅ **Hardening 5 étapes + reboot** :
- User `nexus` + clé SSH Ed25519 dédiée
- Port SSH custom **2222** (override `ssh.socket` Ubuntu 24.04 systemd
  socket activation)
- Root login + password auth désactivés (override
  `50-cloud-init.conf` Hostinger)
- UFW : default deny in / allow out, allow 2222/80/443 (IPv4+IPv6)
- fail2ban (jail sshd, port 2222, bantime 24h, backend systemd)
- unattended-upgrades vérifié actif
- 69 paquets upgradés, kernel 6.8.0-78 → 6.8.0-111
- Reboot validé, Traefik + n8n up

✅ **Doc** :
- `.agent/notes/vps-hostinger.md` réécrite (état réel + 3 pièges
  Ubuntu/Hostinger documentés)
- `.agent/notes/traefik-existing.md` créée (audit + stratégie greffe)

#### Pièges traversés

1. **Socket activation SSH Ubuntu 24.04** : `Port` dans sshd_config
   ignoré, override `/etc/systemd/system/ssh.socket.d/override.conf`
   nécessaire.
2. **`IPV6_V6ONLY=1` sur `ListenStream=<port>` nu** : systemd applique
   IPv6-only même si `bindv6only=0`. Toujours spécifier
   `0.0.0.0:port` ET `[::]:port`.
3. **Hostinger `50-cloud-init.conf`** : override `PasswordAuthentication
   yes` au boot (lu en premier, gagne via "first match wins" OpenSSH).
4. **Docker bypass UFW** : ports `0.0.0.0:*` exposés Docker passent
   AVANT UFW. Pas critique chez nous (on veut 80/443 publics).

### Bloc 2 — Prep code déploiement (~1h)

✅ **ADR-030** créé : Traefik au lieu de Caddy (amende ADR-012)

✅ **Dockerfile** multi-stage (~150-250 MB)
- Stage base (node:22-alpine + corepack pnpm)
- Stage deps (full install + python/make/g++ pour argon2 natif)
- Stage builder (build shared puis backend via tsc)
- Stage runner (prod deps, USER node, healthcheck via fetch natif)

✅ **`.dockerignore`** : exclut node_modules, dist, .agent, .git, tests,
desktop/web/mobile (image backend uniquement)

✅ **`infra/docker-compose.prod.yml`** : 5 services (backend +
worker-reminders + worker-purge + postgres + redis), 2 networks
(`root_default` external + `nexus-internal` isolé), 2 volumes
persistants, Docker secrets pour Postgres credentials, labels Traefik
complets pour `api.nexusapp.chat` + pages publiques sur `nexusapp.chat`.

✅ **`infra/.env.production.example`** : template complet avec toutes
les vars requises par `core/env.ts` (DATABASE_URL, REDIS_URL, JWT
secrets, WS_HEARTBEAT_INTERVAL_MS, RATE_LIMIT_AUTH_MAX,
ANTHROPIC_DEFAULT_MODEL, WEB_BASE_URL).

✅ **`infra/secrets/.gitkeep`** : structure pour Docker secrets pg
(jamais commités, fichiers réels créés sur le VPS).

✅ **`infra/deploy.sh`** : script idempotent qui pull → ensure pg/redis →
job migration one-shot (advisory lock) → swap backend → healthcheck →
rollback automatique au tag précédent si KO.

✅ **`infra/db.md`** : règles expand/contract pour migrations, advisory
lock, workflow ajout migration, procédure backup pg_dump + restore.

✅ **`.github/workflows/deploy.yml`** : 3 jobs (build → sync-infra →
deploy), GHCR push avec cache `gha`, SSH au VPS via secrets, healthcheck
external post-deploy (vérifie que Traefik route OK).

✅ **`packages/backend/src/scripts/migrate-prod.ts`** : wrapper qui
acquiert `pg_advisory_lock(871234567)` puis appelle
`drizzle-orm/postgres-js/migrator.migrate()`. Lock auto-released sur
fermeture connexion (filet de sécurité crash).

✅ **Adaptations monorepo pour build prod** :
- `packages/shared/package.json` : ajoute script `build: tsc` +
  `dev: tsc --watch`, exports `default` pointe sur `./dist/index.js` (au
  lieu de `./src/index.ts`). Types restent sur src.
- `packages/backend/package.json` : drizzle-kit déplacé de devDeps vers
  deps (besoin pour `db:migrate:prod` en runtime), nouveau script
  `db:migrate:prod`.
- `turbo.json` : `dev` dépend désormais de `^build` (build shared avant
  watchers).
- `.gitignore` : ajout `infra/secrets/*` (sauf .gitkeep) +
  `.env.production`.

### Fichiers modifiés / créés

```
.agent/adr/ADR-030-reverse-proxy-traefik-existant.md  # NOUVEAU
.agent/current-task.md                                # ce fichier
.agent/notes/traefik-existing.md                      # NOUVEAU (bloc 1)
.agent/notes/vps-hostinger.md                         # réécrit (bloc 1)
.dockerignore                                         # NOUVEAU
.github/workflows/deploy.yml                          # NOUVEAU
.gitignore                                            # +infra/secrets+.env.prod
Dockerfile                                            # NOUVEAU
infra/.env.production.example                         # NOUVEAU
infra/README.md                                       # NOUVEAU
infra/db.md                                           # NOUVEAU
infra/deploy.sh                                       # NOUVEAU
infra/docker-compose.prod.yml                         # NOUVEAU
infra/secrets/.gitkeep                                # NOUVEAU
packages/backend/package.json                         # drizzle-kit deps + db:migrate:prod
packages/backend/src/scripts/migrate-prod.ts          # NOUVEAU
packages/shared/package.json                          # build script + exports dist
turbo.json                                            # dev dependsOn ^build
```

### Côté VPS (état post-hardening)

```
/etc/ssh/sshd_config                              # PermitRootLogin/PubkeyAuth
/etc/ssh/sshd_config.d/50-cloud-init.conf         # PasswordAuth yes → no
/etc/systemd/system/ssh.socket.d/override.conf    # CRÉÉ port 2222 IPv4+IPv6
/etc/fail2ban/jail.local                          # CRÉÉ jail sshd port 2222
/home/nexus/.ssh/authorized_keys                  # CRÉÉ
+ kernel 6.8.0-111, Docker 29.4.3, Compose v5.1.3
```

## 🎯 Action immédiate côté Manu

1. **Snapshot Hostinger** post-hardening (panel)
2. **DNS records** `nexusapp.chat` (3 records A vers `72.61.162.195`)
3. **Local checks + commit** (cf. section "AVANT DE COMMIT" en haut)
4. **GitHub secrets** pour `deploy.yml` (5 secrets)
5. **Provisionnement initial VPS** (cf. section dédiée)
6. Premier deploy CI ou manuel

## Blockers

Aucun bloquant. Le repo est prêt à recevoir le merge. Le deploy effectif
suivra dès que les DNS sont configurés et les GitHub secrets posés.
