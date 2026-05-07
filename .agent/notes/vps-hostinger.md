# VPS Hostinger — état réel

**Dernière vérif** : 2026-05-07 (post-hardening + reboot)

## Specs

| Item                | Valeur                                          |
| ------------------- | ----------------------------------------------- |
| Plan                | KVM 2                                           |
| OS                  | Ubuntu 24.04.3 LTS (noble)                      |
| Kernel              | 6.8.0-111-generic (post-upgrade 2026-05-07)     |
| Localisation        | France / Paris                                  |
| vCPU                | 2                                               |
| RAM                 | 8 Go                                            |
| Disque              | 100 Go (5.4 Go utilisés)                        |
| Bande passante      | 8 To / mois                                     |
| IPv4                | `72.61.162.195`                                 |
| IPv6                | `2a02:4780:28:d8b9::1`                          |
| Hostname Hostinger  | `srv1068104.hstgr.cloud`                        |
| Domaine custom      | `nexusapp.chat` (records A à configurer)        |
| Renouvellement auto | Activé jusqu'au 2027-01-16                      |

## Accès SSH (post-hardening)

```powershell
# Depuis Windows
ssh -i $HOME\.ssh\nexus_vps -p 2222 nexus@72.61.162.195
```

| Item                | Valeur                                  |
| ------------------- | --------------------------------------- |
| User                | `nexus` (sudo password requis)          |
| Clé privée          | `~/.ssh/nexus_vps` (Ed25519)            |
| Port SSH            | **2222** (custom, 22 fermé)             |
| PermitRootLogin     | **no**                                  |
| PasswordAuth        | **no** (pubkey only)                    |
| PubkeyAuth          | yes                                     |

⚠️ **Piège Ubuntu 24.04 — systemd socket activation pour SSH** :
sshd est gouverné par `ssh.socket` qui décide des ports d'écoute, **pas
sshd_config**. Modifier `Port` dans sshd_config est ignoré. Pour changer
les ports, créer un override dans `/etc/systemd/system/ssh.socket.d/override.conf` :

```ini
[Socket]
ListenStream=
ListenStream=0.0.0.0:2222
ListenStream=[::]:2222
```

⚠️ **Piège systemd `ListenStream=<port>`** : sans préfixe IP explicite,
systemd applique `IPV6_V6ONLY=1` → bind IPv6-only même si
`net.ipv6.bindv6only=0`. **Toujours spécifier `0.0.0.0:port` ET `[::]:port`**
pour avoir IPv4 + IPv6.

⚠️ **Piège Hostinger cloud-init** : `/etc/ssh/sshd_config.d/50-cloud-init.conf`
override `PasswordAuthentication yes` au boot. La modif faite directement
dans ce fichier est persistée, mais si cloud-init est ré-exécuté
(`cloud-init clean`), il pourrait réécrire le fichier. Pour blindage long
terme : créer `/etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg` avec
`ssh_pwauth: false` (TODO post-V1, pas critique).

## Hardening complet (2026-05-07)

| Mesure                      | État                                                  |
| --------------------------- | ----------------------------------------------------- |
| User `nexus` + clé SSH      | ✅ Ed25519 dédiée, sudo with password                  |
| Root login SSH désactivé    | ✅ `PermitRootLogin no`                                |
| Password auth désactivé     | ✅ `PasswordAuthentication no` (override 50-cloud-init)|
| Port SSH custom 2222        | ✅ via override `/etc/systemd/system/ssh.socket.d/`   |
| UFW                         | ✅ default deny in / allow out, allow 2222/80/443     |
| fail2ban (sshd jail)        | ✅ port 2222, bantime 24h, maxretry 5, backend systemd|
| unattended-upgrades         | ✅ security only (default Ubuntu)                     |
| Updates système appliqués   | ✅ 69 paquets le 2026-05-07 (kernel inclus)           |
| Reboot post-upgrade         | ✅ kernel 6.8.0-111-generic                           |

## Stack Docker actuelle (existant non-Nexus)

```
NAMES            IMAGE                     PORTS                                 STATUS
root-traefik-1   traefik                   0.0.0.0:80→80, 0.0.0.0:443→443        Up
root-n8n-1       docker.n8n.io/n8nio/n8n   127.0.0.1:5678→5678                   Up
```

⚠️ **Container `redis` disparu post-reboot** : un container `redis` existait
pré-hardening (image `redis`, port interne 6379, pas exposé) mais ne
redémarre pas après reboot (`restart: unless-stopped` absent ?). n8n
fonctionne toujours sans → pas critique. À investiguer si Manu en a besoin
pour ses workflows. **Pour Nexus : pas d'incidence**, on créera notre propre
Redis dédié (cf. ADR-012 isolation logique).

### Reverse proxy = Traefik (pas Caddy)

ADR-012 prévoyait Caddy. La réalité du VPS : **Traefik** déjà installé et
fonctionnel pour n8n. **Décision** : on garde Traefik et on ajoute la stack
Nexus comme nouveau service derrière le même reverse proxy
(via labels Docker `traefik.http.routers.*`).
→ **À acter par ADR-030 — amendement ADR-012** (TODO session prep code).

Avantages Traefik vs Caddy dans ce contexte :
- Zéro perturbation pour n8n (qui marche depuis 195 jours)
- Gestion HTTPS Let's Encrypt automatique via labels (similaire à Caddy)
- Support WebSocket natif
- Multi-stack docker-compose découplés (Nexus ajouté indépendamment)

### Versions runtime (post-upgrade 2026-05-07)

```
Docker version 29.4.3, build 055a478
Docker Compose version v5.1.3
```

## Charge actuelle (post-reboot 2026-05-07)

- CPU : ~0%
- RAM : ~1.3 Go / 8 Go (16%)
- Disque : 5.4 Go / 100 Go (5.6%)
- Marge confortable pour empiler la stack Nexus

## Plan d'hébergement Nexus (au déploiement V1)

| Composant                       | RAM estimée   |
| ------------------------------- | ------------- |
| Existant (Traefik + n8n)        | ~1.3 Go       |
| Backend Nexus (Fastify)         | 200 Mo        |
| PostgreSQL Nexus dédié          | 300-500 Mo    |
| Redis Nexus dédié               | 100 Mo        |
| Worker Discord                  | 80 Mo         |
| Worker WhatsApp (Baileys)       | 150 Mo        |
| Conduit (homeserver)            | 250 Mo        |
| mautrix-meta (bridge)           | 300 Mo        |
| Overhead OS                     | 500 Mo        |
| **Total avec Nexus complet**    | **~3-3.5 Go** |
| **Marge restante**              | **~4.5 Go**   |

## Exposition Internet (V1)

- Domaine cible : `nexusapp.chat` (records A à pointer sur 72.61.162.195)
  - `nexusapp.chat` → landing
  - `app.nexusapp.chat` → web app SPA
  - `api.nexusapp.chat` → backend Fastify (API + WS)
- Hostname Hostinger conservé en fallback : `srv1068104.hstgr.cloud`
- Certificats TLS : Let's Encrypt automatique via Traefik (provider
  cert-resolver, à configurer dans le compose)

## Ports occupés / alloués

### Publics (UFW + Docker bind 0.0.0.0)

| Port | Service            | Notes                              |
| ---- | ------------------ | ---------------------------------- |
| 2222 | SSH (custom)       | UFW allow                          |
| 80   | Traefik HTTP       | Docker bind, redirect → 443        |
| 443  | Traefik HTTPS      | Docker bind, terminator TLS        |

### Internes (loopback ou réseau Docker)

| Port  | Service          | Bind             |
| ----- | ---------------- | ---------------- |
| 5678  | n8n (existant)   | 127.0.0.1 only   |
| 3000  | Backend Nexus    | nexus-internal (futur)   |
| 5432  | Postgres Nexus   | nexus-internal (futur)   |
| 6379  | Redis Nexus      | nexus-internal (futur)   |

⚠️ **Docker bypass UFW pour `0.0.0.0:*`** : les ports exposés par Docker
en `0.0.0.0` (80, 443) restent publics même si UFW est en deny incoming
— Docker écrit ses règles iptables avant celles d'UFW. C'est ce qu'on
veut (Traefik doit être public). UFW protège les services système
non-Docker (sshd) et tout port non-Docker qui écouterait par accident.

## TODO ops avant prod V1

1. ✅ ~~Audit firewall UFW~~ — fait 2026-05-07
2. ✅ ~~Création utilisateur non-root~~ — `nexus` créé 2026-05-07
3. ✅ ~~Hardening complet~~ — fait 2026-05-07
4. ⏳ Snapshot Hostinger post-hardening — en cours
5. ⏳ DNS records `nexusapp.chat` — en cours (3 records A vers 72.61.162.195)
6. **ADR-030** — amendement ADR-012, acter Traefik au lieu de Caddy
7. **User `nexus-deploy`** dédié à la CI (NOPASSWD limité à
   `docker compose pull/up`) — créer au moment de la première itération
   du pipeline `deploy.yml`
8. Investiguer container `redis` disparu (pas critique mais bizarre)
9. Stratégie backup : `pg_dump` quotidien vers Backblaze B2 ou Cloudflare R2
   (~5 €/an pour le volume cible) + procédure de restore testée
10. Long terme — blindage cloud-init (`/etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg`)

## Procédure d'urgence — Si on perd l'accès SSH

Hostinger fournit une **console KVM** dans le panel (VPS → Aperçu →
Console). Permet d'accéder au VPS comme physiquement, même si SSH est
cassé. Login `root` avec le password initial Hostinger (toujours actif,
juste pas utilisable via SSH). On peut depuis là restaurer
`/etc/ssh/sshd_config`, désactiver UFW (`ufw disable`), etc.

Snapshots Hostinger : restauration en quelques clics au snapshot
"post-hardening-2026-05-07" si tout casse.
