# VPS Hostinger — hardening pré-prod

**Cible** : KVM2 Ubuntu 24.04, IP `72.61.162.195`, hostname `srv1068104.hstgr.cloud`
**Statut** : à exécuter par Manu **avant** déploiement V1 (J9)
**Estimation** : 30-45 min, plus la création/test des comptes user

## Diagnostic actuel (à confirmer par Manu)

- ✅ n8n déjà installé (à conserver)
- ❌ UFW à 0 règles (firewall ouvert)
- ❌ Login root par mot de passe activé (SSH bruteforce-friendly)
- ❌ Pas de fail2ban
- ❌ Pas de `unattended-upgrades` configuré
- ✅ Snapshot Hostinger récent (2)

Vérification rapide (sur le VPS) :

```bash
sudo ufw status verbose
sudo grep -E '^(PermitRootLogin|PasswordAuthentication)' /etc/ssh/sshd_config
which fail2ban-server || echo "fail2ban non installé"
dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && echo OK || echo "unattended non actif"
```

## Plan en 5 étapes

### 1) Créer un user nexus + clé SSH dédiée (depuis ta machine locale)

```powershell
# Génère une paire de clés ED25519 dédiée à Nexus (côté Windows, dans WSL ou Git Bash)
ssh-keygen -t ed25519 -f $HOME/.ssh/nexus_vps -C "manu@nexus-vps"

# Copie la clé publique sur le VPS via root (auth password actuelle)
type $HOME/.ssh/nexus_vps.pub | ssh root@72.61.162.195 "mkdir -p /tmp/keys && cat > /tmp/keys/nexus.pub"
```

Sur le VPS (toujours en root) :

```bash
# Crée le user nexus
sudo adduser --disabled-password --gecos "" nexus
sudo usermod -aG sudo nexus

# Installe la clé SSH
sudo mkdir -p /home/nexus/.ssh
sudo cp /tmp/keys/nexus.pub /home/nexus/.ssh/authorized_keys
sudo chown -R nexus:nexus /home/nexus/.ssh
sudo chmod 700 /home/nexus/.ssh
sudo chmod 600 /home/nexus/.ssh/authorized_keys
sudo rm -rf /tmp/keys

# Vérifie : depuis ta machine locale, ouvre une 2e session ssh
# (laisse la session root active dans une 1ère fenêtre — sécurité)
ssh -i $HOME/.ssh/nexus_vps nexus@72.61.162.195
sudo whoami  # doit retourner "root"
```

### 2) Désactiver login root + password auth

**À faire SEULEMENT après avoir confirmé que la clé nexus fonctionne.**

Sur le VPS, en tant que `nexus` (sudo) :

```bash
# Backup avant modif
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d)

# Désactive root login + password auth
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Vérifie syntax avant restart (sinon SSH ne redémarre pas et tu peux perdre l'accès)
sudo sshd -t
echo "exit code: $?"  # doit être 0

# Restart sshd
sudo systemctl restart sshd

# Test : ouvre une 3e session pour valider que la clé marche TOUJOURS
ssh -i $HOME/.ssh/nexus_vps nexus@72.61.162.195
```

⚠️ Si la 3e session échoue, tu as toujours la 1ère (root) ouverte pour annuler :
`sudo cp /etc/ssh/sshd_config.bak.YYYYMMDD /etc/ssh/sshd_config && sudo systemctl restart sshd`

### 3) Configurer UFW

```bash
# Allow SSH d'abord (sinon on coupe la connexion en activant)
sudo ufw allow 22/tcp comment 'SSH'

# HTTP/HTTPS pour nginx (Nexus + n8n derrière)
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Defaults : deny incoming, allow outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Active
sudo ufw --force enable

# Vérifie
sudo ufw status verbose
```

⚠️ Note : si n8n écoute sur un port custom (5678 par défaut), il est déjà
derrière nginx via vhost — donc pas besoin d'ouvrir le port directement.
À confirmer en regardant la config nginx existante :
`sudo nginx -T 2>/dev/null | grep -E 'listen|server_name'`.

### 4) Installer fail2ban (basique SSH)

```bash
sudo apt-get update
sudo apt-get install -y fail2ban

# Config par défaut suffit pour SSH. On override quand même pour ban plus long.
sudo tee /etc/fail2ban/jail.local > /dev/null <<'EOF'
[DEFAULT]
bantime = 24h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = systemd
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd  # vérifie
```

### 5) Mises à jour automatiques (security only)

```bash
sudo apt-get install -y unattended-upgrades apt-listchanges
sudo dpkg-reconfigure --priority=low unattended-upgrades  # → "Yes"

# Vérifie config
sudo cat /etc/apt/apt.conf.d/20auto-upgrades
# Doit contenir :
#   APT::Periodic::Update-Package-Lists "1";
#   APT::Periodic::Unattended-Upgrade "1";

# Test sans appliquer
sudo unattended-upgrades --dry-run --debug 2>&1 | tail -20
```

## Validation post-hardening

Depuis ta machine Windows :

```powershell
# 1. SSH root par password → doit échouer
ssh root@72.61.162.195
# → "Permission denied (publickey)"

# 2. SSH nexus par clé → doit marcher
ssh -i $HOME/.ssh/nexus_vps nexus@72.61.162.195

# 3. Sur le VPS :
sudo ufw status        # → 22, 80, 443 allow ; default deny
sudo systemctl status fail2ban  # → active (running)
sudo cat /etc/ssh/sshd_config | grep -E 'Permit|Password|Pubkey'
```

## Checklist finale

- [ ] User nexus créé avec sudo
- [ ] Clé SSH dédiée installée + testée depuis 2 sessions
- [ ] `PermitRootLogin no` + `PasswordAuthentication no`
- [ ] sshd restart sans erreur (syntax check passe)
- [ ] UFW : default deny, allow 22/80/443
- [ ] n8n toujours accessible via son URL (test post-UFW)
- [ ] fail2ban actif sur sshd
- [ ] unattended-upgrades configuré (security only)
- [ ] 2e snapshot Hostinger pris **après** hardening (point de restauration)

## Pour plus tard (J9 déploiement)

Pas dans ce hardening, mais à organiser quand on déploiera Nexus :

- Cohabitation n8n / Nexus : nginx vhosts séparés, ports backend internes
  non exposés (`127.0.0.1:3000` etc.), bases PG dédiées
- TLS Let's Encrypt sur `srv1068104.hstgr.cloud` (certbot — probablement déjà
  fait pour n8n, à étendre)
- Backup pg_dump quotidien vers un bucket S3-compatible (Backblaze B2 OBP
  ou Cloudflare R2, ~5 €/an pour le volume cible)
- Monitoring basique : `htop`, `vnstat`, ou `netdata` léger en option
