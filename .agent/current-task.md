# Tâche en cours

**Dernière session** : 2026-05-07 (hardening VPS) — clôturée 🟢
**Statut repo** : `main` à jour, CI tout vert (typecheck + lint+format + test)
**Statut VPS** : hardening complet, prêt à recevoir la stack Nexus

## 🚀 Reprise — sessions à venir

### Pré-prod (côté Manu, pas de code à attendre)

1. ✅ ~~**Hardening VPS Hostinger**~~ — fait 2026-05-07. Détails complets
   dans `.agent/notes/vps-hostinger.md`. Accès VPS désormais :
   ```powershell
   ssh -i $HOME\.ssh\nexus_vps -p 2222 nexus@72.61.162.195
   ```
2. ⏳ **Snapshot Hostinger post-hardening** — à confirmer côté Manu (panel
   Hostinger → VPS → Snapshots). Nom suggéré : `nexus-vps-post-hardening-2026-05-07`.
3. ⏳ **DNS records nexusapp.chat** — à configurer côté Manu (panel
   Hostinger → Domaines → DNS) :
   - `@` (apex) → A 72.61.162.195
   - `app` → A 72.61.162.195
   - `api` → A 72.61.162.195
   - Optionnellement les AAAA vers `2a02:4780:28:d8b9::1`
4. **Validation pack ADR fondateurs 001-010** — relecture + accept par
   Manu. Bloquant V1, en suspens depuis longtemps.

### Session prep code (à venir — 2-3h)

Tout le contexte VPS est consigné. La prochaine session attaque la prep
code dans cet ordre :

5. **ADR-030 — Amendement ADR-012 : Traefik au lieu de Caddy** — acter
   formellement le choix, expliquer le rationale (existant fonctionnel
   sur le VPS, pas de raison de migrer). Voir
   `.agent/notes/traefik-existing.md` pour la stratégie de greffe.
6. **Dockerfile backend multi-stage** — `packages/backend/Dockerfile`,
   image finale ~80 MB sur `node:22-alpine`. Stages : deps → builder →
   runner.
7. **`infra/docker-compose.prod.yml`** — squelette validé dans
   `.agent/notes/traefik-existing.md`. Compose séparé qui se branche au
   network `root_default` (existant Traefik) en `external: true`. 2
   networks : `root_default` (avec backend pour Traefik) +
   `nexus-internal` (Postgres + Redis isolés).
8. **`infra/.env.production` template** — template avec placeholders pour
   les secrets, vrai fichier monté à la main dans `/opt/nexus/.env.production`
   sur le VPS (mode 0600).
9. **`infra/deploy.sh`** — script de deploy idempotent : pull image,
   migration job one-shot avec advisory lock (cf. ADR-013), swap backend,
   healthcheck, rollback si KO.
10. **`.github/workflows/deploy.yml`** — pipeline CD : build image →
    push GHCR → SSH au VPS → `deploy.sh`.
11. **Wrapper `db:migrate:prod`** — script avec advisory lock
    `pg_advisory_lock(871234567)` (cf. ADR-013) pour éviter les
    races sur deploys concurrents.

### Quick wins UI (sessions courtes, ~30-60 min chacune)

12. **Validation visuelle Tauri post-Bloc-E** — lancer `pnpm tauri:dev`
    et vérifier la timeline d'activité (créer event/poll → vérifier
    l'apparition en quasi temps réel sur Home + GroupHome).
13. **Externalisation logo pro** (optionnel, V1 public) — brief Fiverr/Upwork
    ~50-300 € pour identité durable. Master AI/SVG livré → regen auto via
    le script. Cf. `.agent/skills/regenerate-icons.md`.

### Chantiers structurants (sessions longues)

14. **Politique de logs prod** (J9 prep) — que loguer (jamais PII messages
    bridgés en clair), rotation, rétention. À documenter dans
    `.agent/notes/logs-policy.md` + appliquer à pino + workers.
15. **ADR-031 — Purge périodique notifications + activity_log** — worker
    BullMQ nocturne, rétention configurée (30 j pour notifs, indéfini V1
    pour activity_log mais à reconsidérer si volume).
16. **Backup pg_dump quotidien** — bucket S3-compatible (Backblaze B2 ou
    Cloudflare R2, ~5 €/an pour le volume cible). Procédure de restore
    testée au moins une fois.

### TODO post-V1 — durcissement Traefik (cf. `.agent/notes/traefik-existing.md`)

- Désactiver `--api.insecure=true`, dashboard avec basic-auth middleware
- Remplacer email LE placeholder `user@srv1068104.hstgr.cloud` par vrai
  email Manu
- Access logs Traefik avec rotation
- Optionnel HTTP/3 sur entrypoint websecure

### Idées pour plus tard (V1.x — pas urgent)

- Logos colored=true dans Settings (actuellement monochrome — choix design
  à arbitrer)
- Pre-commit hook husky/lefthook pour lancer `prettier --write` auto sur
  fichiers staged (évite de re-rencontrer le format-check rouge en CI)
- 112 warnings lint résiduels (95 auto-fixables avec `--fix`, le reste
  c'est des `no-non-null-assertion` dans queries.ts à refacto)
- Dette : `useEvents`, `useExpenses`, etc. côté front utilisent des `!`
  (non-null assertions) un peu partout → typer proprement
- Container `redis` disparu du compose root post-reboot 2026-05-07 — à
  investiguer si Manu en a besoin pour ses workflows n8n. Pas critique
  pour Nexus (on aura notre Redis dédié).
- Long terme — blindage cloud-init via
  `/etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg` avec `ssh_pwauth: false`
  (évite que cloud-init réécrive `50-cloud-init.conf` sur un re-deploy)

---

## 📚 Session 2026-05-07 — Hardening VPS Hostinger

### Contexte initial

VPS KVM2 Ubuntu 24.04 (`72.61.162.195`, `srv1068104.hstgr.cloud`) en état
"out of the box" Hostinger : root login par password, UFW à 0 règles,
fail2ban absent. n8n + Traefik + redis déjà en container Docker depuis
~3 mois (uptime 195 j).

### Livré ce passage

#### 1. Audit VPS complet

- ✅ État sécurité initial (root password actif, UFW off, fail2ban absent)
- ✅ Stack Docker existante (Traefik + n8n + redis sur network `root_default`)
- ✅ Services système (containerd, docker, ssh socket-activated, cron,
  unattended-upgrades, etc.)
- ✅ Versions OS / kernel / Docker

#### 2. Hardening complet (5 étapes du plan + reboot)

- ✅ User `nexus` + clé SSH Ed25519 dédiée (`~/.ssh/nexus_vps` côté Windows)
- ✅ Password setté pour `nexus` (sudo demande password, pas NOPASSWD)
- ✅ Root login SSH désactivé (`PermitRootLogin no`)
- ✅ Password auth désactivé (`PasswordAuthentication no` dans
  `50-cloud-init.conf` qui était l'override gagnant)
- ✅ **Port SSH custom 2222** — via override
  `/etc/systemd/system/ssh.socket.d/override.conf` (pas via sshd_config
  sur Ubuntu 24.04 socket-activated)
- ✅ UFW actif (default deny in / allow out, allow 2222/80/443 IPv4+IPv6)
- ✅ fail2ban (jail sshd port 2222, bantime 24h, backend systemd)
- ✅ unattended-upgrades vérifié actif (security only par défaut Ubuntu)
- ✅ 69 paquets upgradés (kernel 6.8.0-78 → 6.8.0-111, Docker
  28.3.3 → 29.4.3, compose 2.39.1 → 5.1.3, cloud-init en hold)
- ✅ Reboot validé — Traefik + n8n up, services système OK, SSH 2222 répond

#### 3. Audit Traefik existant + stratégie de greffe Nexus

Détaillé dans **`.agent/notes/traefik-existing.md`** :
- Compose root `/root/docker-compose.yml` (intouchable côté Nexus)
- Network `root_default` (bridge) à rejoindre en `external: true`
- Provider Docker socket reader, `exposedbydefault=false`
- Cert resolver `mytlschallenge` (TLS-ALPN-01) réutilisable pour
  `nexusapp.chat`
- Stratégie : compose Nexus séparé `/opt/nexus/docker-compose.yml`,
  squelette validé dans la note avec labels Traefik prêts à l'emploi
- 2 networks pour Nexus : `root_default` (backend visible Traefik) +
  `nexus-internal` avec `internal: true` (Postgres+Redis isolés)

#### 4. Documentation `.agent/notes/vps-hostinger.md` réécrite

- État réel post-hardening avec spécifications précises
- 3 pièges Ubuntu 24.04 / Hostinger documentés :
  - Socket activation SSH (ssh.socket > sshd_config)
  - `IPV6_V6ONLY=1` par défaut sur `ListenStream=<port>` nu
  - `50-cloud-init.conf` override Hostinger
- Checklist d'accès SSH post-hardening
- Procédure d'urgence (console KVM Hostinger + snapshot rollback)
- Plan d'hébergement + ports + capacité

### Pièges traversés (à connaître pour reprises futures)

#### Piège 1 — Socket activation SSH Ubuntu 24.04

`sshd` n'écoute **pas** sur les ports listés dans `sshd_config` quand la
distribution utilise systemd socket activation. Sur Ubuntu 24.04, c'est
le cas par défaut. Modifier `Port` dans `sshd_config` est silencieusement
ignoré. Il faut overrider `ssh.socket` :

```bash
sudo mkdir -p /etc/systemd/system/ssh.socket.d
sudo tee /etc/systemd/system/ssh.socket.d/override.conf > /dev/null <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:2222
ListenStream=[::]:2222
EOF
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket ssh.service
```

La ligne vide `ListenStream=` est essentielle (reset des valeurs héritées).

#### Piège 2 — IPV6_V6ONLY sur ListenStream nu

`ListenStream=22` (sans préfixe IP) est interprété par systemd comme
**IPv6 dual-stack théorique**, mais en pratique systemd applique
`IPV6_V6ONLY=1` → bind IPv6-only **même si `net.ipv6.bindv6only=0`**.
Conséquence : `ss` montre `[::]:22` mais `nc 127.0.0.1 22` retourne
"Connection refused". Pour avoir IPv4 + IPv6 vraiment, **toujours
spécifier les deux familles** :

```ini
ListenStream=0.0.0.0:2222
ListenStream=[::]:2222
```

#### Piège 3 — Hostinger `50-cloud-init.conf` override SSH

Hostinger livre Ubuntu 24.04 avec un override cloud-init dans
`/etc/ssh/sshd_config.d/50-cloud-init.conf` qui contient
`PasswordAuthentication yes`. Ce fichier est lu en premier (numéro 50
< 60), et OpenSSH applique la règle "premier match gagne". Modifier
`PasswordAuthentication no` dans `/etc/ssh/sshd_config` est sans effet.
Il faut modifier directement `50-cloud-init.conf`.

Vérifier la config effective via `sudo sshd -T` (qui dump la config
résolue après tous les Includes).

Pour blindage long terme contre une ré-exécution cloud-init, créer
`/etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg` avec
`ssh_pwauth: false` (pas fait, tracé en TODO post-V1).

#### Piège 4 — Docker bypass UFW

Les containers Docker exposés en `0.0.0.0:port` (chez nous : Traefik
sur 80/443) **bypass UFW**. Docker écrit ses règles dans iptables qui
passent avant celles d'UFW. Conséquence : `ufw default deny incoming`
ne ferme pas 80/443 si Docker les expose. C'est ce qu'on veut (Traefik
doit être public). Mais il faut savoir qu'**UFW protège uniquement les
services système non-Docker** (sshd, et tout port qui écouterait par
accident sans passer par Docker).

### Fichiers modifiés / créés

```
.agent/current-task.md                 # ce fichier
.agent/notes/vps-hostinger.md          # réécrit avec état réel post-hardening
.agent/notes/traefik-existing.md       # NOUVEAU — audit Traefik + stratégie greffe Nexus
```

Côté VPS (à savoir pour reprise) :

```
/etc/ssh/sshd_config                              # modifié (PermitRootLogin/PubkeyAuth)
/etc/ssh/sshd_config.d/50-cloud-init.conf         # PasswordAuthentication yes → no
/etc/systemd/system/ssh.socket.d/override.conf    # CRÉÉ (port 2222 IPv4+IPv6)
/etc/fail2ban/jail.local                          # CRÉÉ (jail sshd port 2222)
/home/nexus/.ssh/authorized_keys                  # CRÉÉ
```

## 🎯 Action immédiate côté Manu

1. **Snapshot Hostinger** post-hardening (panel Hostinger → VPS → Snapshots)
2. **DNS records** dans le panel Hostinger pour `nexusapp.chat`
3. Optionnel : changer le password root Hostinger pour un long aléatoire
   stocké dans password manager (filet de sécurité ; le password n'est
   plus utilisable via SSH mais reste actif sur la console KVM)

## Blockers

Aucun. Le VPS est prêt à recevoir la stack Nexus. Prochaine session = prep
code (Dockerfile + ADR-030 + docker-compose.prod.yml + deploy.yml).
