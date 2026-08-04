# MAN-20 — Runbook durcissement Traefik + audit VPS

**Contexte** : ce runbook accompagne le ticket Linear MAN-20. Il est écrit
pour être **exécuté par Manu directement sur le VPS** — l'agent n'a pas
d'accès SSH à cette machine (ni ne devrait tenter d'en obtenir un pour ce
type d'opération : firewall/SSH/reverse-proxy partagé avec n8n, risque de
lockout ou de coupure de service en cas d'erreur).

Chaque section est autonome. Faire les sections **dans l'ordre** — chacune
suppose la précédente terminée et vérifiée.

## ⚠️ Constat préalable — le ticket est partiellement obsolète

`.agent/notes/vps-hostinger.md` documente un hardening VPS déjà fait le
**2026-05-07** (le même jour que l'audit source du ticket) :

- ✅ UFW configuré (deny in / allow out, allow 2222/80/443)
- ✅ Utilisateur non-root `nexus` créé
- ✅ Login root SSH désactivé (`PermitRootLogin no`)
- ✅ Auth par mot de passe désactivée (pubkey only)
- ✅ fail2ban actif sur sshd (port 2222, bantime 24h, maxretry 5)

**La section "VPS" du ticket (UFW, user non-root, root login, fail2ban) est
donc déjà satisfaite** — le texte du ticket ("0 règle côté Hostinger à
date") date d'avant cette passe et n'a jamais été mis à jour. Seul reste
un point mineur non fermé (cloud-init, cf. Section 3 ci-dessous).

**Ce qui reste réellement ouvert** : la section "Traefik" du ticket, en
entier — rien n'a été fait de ce côté (confirmé par
`.agent/notes/traefik-existing.md`, TODO jamais traité).

---

## Avant de commencer — filet de sécurité

Traefik dans `/root/docker-compose.yml` est **partagé avec n8n**. Une
erreur ici peut casser n8n ou couper l'accès HTTPS à `nexusapp.chat` et
`api.nexusapp.chat`. Protocole à respecter :

1. **Garder une deuxième session SSH ouverte** avant de toucher à
   quoi que ce soit qui touche à l'authentification SSH ou à UFW. Si la
   première session se coupe après un changement raté, la deuxième reste
   ton filet de secours pour annuler.
2. **Snapshot Hostinger avant de commencer** (panel Hostinger → VPS →
   Snapshots → créer). `.agent/notes/vps-hostinger.md` mentionne un
   snapshot "post-hardening-2026-05-07" — vérifier qu'il existe encore, ou
   en refaire un frais avant cette session.
3. **Une modification à la fois, vérifiée avant de passer à la suivante.**
   Ne pas enchaîner plusieurs changements Traefik sans redémarrer et
   vérifier entre deux (n8n **et** Nexus doivent continuer à répondre après
   chaque étape).
4. **Procédure d'urgence si tout casse** : console KVM Hostinger (panel →
   VPS → Aperçu → Console), login `root` avec le password initial Hostinger
   (toujours actif hors SSH). Depuis là : restaurer le snapshot, ou éditer
   `/root/docker-compose.yml` / `ufw disable` directement.

```bash
# Connexion (depuis Windows, cf. vps-hostinger.md)
ssh -i $HOME\.ssh\nexus_vps -p 2222 nexus@72.61.162.195
```

---

## Section 1 — Traefik : état actuel avant modification

**Ne rien changer avant d'avoir fait ceci** — le fichier peut avoir dérivé
depuis l'audit du 2026-05-07, il faut vérifier l'état réel avant d'appliquer
un diff à l'aveugle.

```bash
# Sauvegarde datée avant toute modif
sudo cp /root/docker-compose.yml /root/docker-compose.yml.bak-$(date +%Y%m%d)

# Version Traefik réellement en cours d'exécution (pas juste le tag "latest")
docker exec root-traefik-1 traefik version

# Contenu actuel du bloc traefik: dans le compose
sudo grep -A 30 "traefik:" /root/docker-compose.yml
```

Note la version exacte retournée par `traefik version` (ex. `v3.1.4`) — elle
sert à l'étape "figer l'image" ci-dessous. **Important** : Traefik route
aussi n8n. Si la version tourne déjà en v3.x, l'objectif est de **figer sur
cette version exacte**, pas de sauter vers une version plus récente
(un upgrade non testé de Traefik pourrait casser le routing n8n en même
temps que celui de Nexus).

---

## Section 2 — Durcissement Traefik (dans `/root/docker-compose.yml`)

Éditer le service `traefik:` du compose root. Les flags ci-dessous sont à
ajouter/modifier dans sa section `command:` (liste de `--flag=valeur`, un
par ligne, format identique à l'existant documenté dans
`.agent/notes/traefik-existing.md`).

### 2.1 — Figer l'image

```yaml
services:
  traefik:
    image: traefik:v3.1.4 # remplacer par la version exacte relevée en Section 1
```

(Remplace `image: traefik:latest` ou équivalent.)

**Vérification** :

```bash
sudo docker compose -f /root/docker-compose.yml up -d traefik
docker exec root-traefik-1 traefik version   # doit matcher exactement
curl -sI https://n8n.srv1068104.hstgr.cloud    # n8n doit répondre 200/30x, pas d'erreur TLS
curl -sI https://api.nexusapp.chat/api/v1/health
```

### 2.2 — Email Let's Encrypt réel

Remplacer le placeholder :

```diff
- --certificatesresolvers.mytlschallenge.acme.email=user@srv1068104.hstgr.cloud
+ --certificatesresolvers.mytlschallenge.acme.email=<vrai email Manu>
```

Sans impact sur les certs déjà émis (cf. ADR-030) — juste les notifs de
renouvellement futures.

### 2.3 — Access logs avec rotation

Ajouter le flag, et faire tourner les logs via le driver Docker plutôt que
via un fichier + logrotate côté host (plus simple, pas de config
supplémentaire à maintenir) :

```yaml
services:
  traefik:
    command:
      - '--accesslog=true'
      # (écrit sur stdout par défaut — capté par le log driver Docker)
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '5'
```

**Vérification** :

```bash
sudo docker compose -f /root/docker-compose.yml up -d traefik
curl -sI https://nexusapp.chat > /dev/null
docker logs root-traefik-1 --tail 5   # doit montrer la requête ci-dessus en JSON
```

### 2.4 — Désactiver le dashboard non-sécurisé

**Option recommandée (la plus simple, zéro exposition publique)** : couper
`api.insecure`, ne rien exposer publiquement. Accès au dashboard uniquement
via tunnel SSH quand besoin.

```diff
- --api.insecure=true
+ --api=true
+ --api.dashboard=true
```

(Pas de `--api.insecure`, pas de router/labels dashboard exposés — le
dashboard reste accessible uniquement depuis le VPS lui-même, sur le port
interne 8080 de Traefik.)

Accès ponctuel depuis un poste local via tunnel SSH :

```bash
ssh -i $HOME\.ssh\nexus_vps -p 2222 -L 8080:localhost:8080 nexus@72.61.162.195
# puis ouvrir http://localhost:8080/dashboard/ dans un navigateur local
```

**Option alternative (dashboard public avec basic-auth)** — seulement si tu
veux vraiment y accéder sans tunnel SSH. Plus de surface d'exposition,
nécessite un sous-domaine DNS (ex. `traefik.nexusapp.chat`) :

```bash
# Génère le hash (nécessite htpasswd — apt install apache2-utils si absent)
# Le $ doit être doublé ($$) pour survivre au parsing docker-compose
htpasswd -nB admin | sed -e 's/\$/\$\$/g'
```

```yaml
services:
  traefik:
    command:
      - '--api=true'
      - '--api.dashboard=true'
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.traefik-dashboard.rule=Host(`traefik.nexusapp.chat`)'
      - 'traefik.http.routers.traefik-dashboard.entrypoints=websecure'
      - 'traefik.http.routers.traefik-dashboard.tls=true'
      - 'traefik.http.routers.traefik-dashboard.tls.certresolver=mytlschallenge'
      - 'traefik.http.routers.traefik-dashboard.service=api@internal'
      - 'traefik.http.routers.traefik-dashboard.middlewares=traefik-auth'
      - 'traefik.http.middlewares.traefik-auth.basicauth.users=admin:<hash généré ci-dessus>'
```

Nécessite au préalable un record DNS A `traefik.nexusapp.chat` → `72.61.162.195`.

**Vérification (option recommandée)** :

```bash
curl -s http://127.0.0.1:8080/api/rawdata | head -c 200   # doit répondre en local
curl -sI https://<ip-ou-hostname-public>:8080/            # doit échouer / timeout (pas exposé)
```

### 2.5 — Optionnel : HTTP/3

```yaml
services:
  traefik:
    command:
      - '--entrypoints.websecure.http3=true'
    ports:
      - '443:443/udp' # QUIC — en plus du 443/tcp déjà présent
```

Nécessite d'ouvrir le port UDP en plus du TCP dans UFW :

```bash
sudo ufw allow 443/udp comment 'Traefik HTTP/3 QUIC'
sudo ufw status numbered   # vérifier la règle
```

---

## Section 3 — Blindage cloud-init (petit reste ouvert)

`.agent/notes/vps-hostinger.md` note que `PasswordAuthentication no` est
actif via un override dans `/etc/ssh/sshd_config.d/50-cloud-init.conf`, mais
qu'un futur `cloud-init clean` pourrait réécrire ce fichier et réactiver
l'auth par mot de passe silencieusement. Blindage permanent :

```bash
sudo tee /etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg > /dev/null <<'EOF'
ssh_pwauth: false
EOF
```

Pas de redémarrage nécessaire — ce fichier n'a d'effet qu'au prochain
`cloud-init` (boot ou `cloud-init clean` explicite), donc zéro risque
immédiat à l'appliquer.

**Vérification** : `cat /etc/cloud/cloud.cfg.d/99-disable-ssh-pwauth.cfg`
affiche bien `ssh_pwauth: false`.

---

## Section 4 — Points à confirmer (pas une action, une vérification)

Ces points du ticket ("cohabitation n8n : vhosts, ports, séparation des
bases") sont déjà satisfaits par l'architecture actuelle documentée dans
`.agent/notes/traefik-existing.md` et `infra/README.md` :

- Réseaux séparés : Nexus (`nexus-internal`, `internal: true`) vs n8n (pas
  sur ce réseau) — pas de conflit possible.
- Ports internes différents (Nexus : 3000/5432/6379 sur `nexus-internal` ;
  n8n : 5678 en localhost-only) — aucun chevauchement.
- Bases de données séparées (Postgres Nexus dédié vs le stockage propre de
  n8n) — pas de partage.

Rien à faire ici — à confirmer une fois en relisant ces deux fichiers, pas
une opération sur le VPS.

**Un point non résolu qui mérite ta décision** (pas bloquant pour ce
ticket, mais à trancher un jour) : `infra/README.md` liste en TODO la
création d'un utilisateur `nexus-deploy` dédié à la CI, avec des droits
sudo limités à `docker compose pull/up` — plutôt que le user `nexus`
générique (sudo complet) actuellement utilisé par le secret GitHub
`VPS_USER`. Pas fait à ce jour (statut confirmé en lisant le secret
GitHub, ce que je ne peux pas faire depuis ce repo). Risque : si la clé
SSH CI fuite, l'attaquant a un sudo complet plutôt que juste
`docker compose`. Faisable dans un ticket séparé si tu veux resserrer ça.

---

## Après exécution

- Mettre à jour `.agent/notes/traefik-existing.md` (section "TODO post-V1")
  et `.agent/notes/vps-hostinger.md` pour refléter l'état réel post-run.
- Marquer MAN-20 en Done dans Linear (ou laisser un commentaire listant ce
  qui a été fait vs reporté, si tu ne fais qu'une partie de ce runbook).
