# VPS Hostinger — état au 2026-04-30

## Specs

| Item                  | Valeur                                             |
|-----------------------|----------------------------------------------------|
| Plan                  | KVM 2                                              |
| OS                    | Ubuntu 24.04 (avec n8n préinstallé via le pack)    |
| Localisation          | France / Paris                                     |
| vCPU                  | 2                                                  |
| RAM                   | 8 Go                                               |
| Disque                | 100 Go                                             |
| Bande passante        | 8 To / mois                                        |
| IPv4                  | `72.61.162.195`                                    |
| Hostname              | `srv1068104.hstgr.cloud`                           |
| Accès SSH             | `ssh root@72.61.162.195`                           |
| Renouvellement auto   | Activé jusqu'au 2027-01-16                         |
| Snapshots             | 2 (sauvegarde existante)                           |
| Disponibilité         | 195 j 22 h (uptime au moment du check)             |

## Charge actuelle (snapshot du 2026-04-30)

- CPU : 1 %
- RAM : 16 % (≈ 1.3 Go utilisés sur 8)
- Disque : 5 Go / 100
- Trafic : 1.1 Mo entrant, négligeable sortant

## Services tiers

- **n8n** — workflow automation, **conservé** (Manu continue d'utiliser pour
  des automatisations indépendantes de Nexus). Cohabitation à organiser au
  déploiement V1 (cf. backlog haute priorité `vps-cohabitation-n8n`).

## Plan d'hébergement Nexus (au déploiement V1)

Le VPS est largement dimensionné pour héberger Nexus en parallèle de n8n.
Estimations à confirmer en charge réelle :

| Composant                  | RAM estimée |
|----------------------------|-------------|
| n8n existant (estimation)  | 500 Mo-1 Go |
| Backend Nexus (Fastify)    | 200 Mo      |
| PostgreSQL                 | 300-500 Mo  |
| Redis                      | 100 Mo      |
| Worker Discord             | 80 Mo       |
| Worker WhatsApp (Baileys)  | 150 Mo      |
| Conduit (homeserver)       | 250 Mo      |
| mautrix-meta (bridge)      | 300 Mo      |
| nginx + certbot            | 50 Mo       |
| Overhead OS                | 500 Mo      |
| **Total Nexus**            | **~1.7 Go** |
| **Total avec n8n**         | **~2.5-3 Go** |
| **Marge restante**         | **~5 Go**   |

Confortable pour le MVP. Une fois la prod stabilisée, on pourra évaluer si
on veut empiler d'autres services (monitoring, CI runner self-hosted, etc.).

## Exposition Internet (pour le MVP)

- Hostname utilisé : `srv1068104.hstgr.cloud`
- Certificat TLS : Let's Encrypt (certbot)
- Tout sous le même hostname pour le MVP :
  - `https://srv1068104.hstgr.cloud/api/v1/*` — API REST
  - `https://srv1068104.hstgr.cloud/ws` — WebSocket
  - `https://srv1068104.hstgr.cloud/e/<slug>`, `/p/<slug>`, etc. — pages publiques (cf. ADR-010)
- Domaine custom à reconsidérer plus tard si Nexus dépasse le cadre de la
  bande d'amis (cf. backlog faible priorité)

## Ports à allouer (V1 prévisionnelle)

À organiser au moment du déploiement, en évitant collision avec n8n :
- 80, 443 : nginx reverse proxy (probablement partagé avec n8n via vhosts)
- 5432 (interne) : PostgreSQL Nexus (peut cohabiter avec n8n ou base dédiée)
- 6379 (interne) : Redis Nexus
- 3000 (interne) : backend Fastify
- 6167 (interne) : Conduit homeserver
- ports internes pour les workers bridges

À documenter précisément dans un fichier `docker-compose.prod.yml` au
moment de J9.

## Sécurité

À auditer avant la mise en production V1 :
- Règles de pare-feu UFW (Hostinger affiche "0 règles" — à durcir)
- Clé SSH dédiée à Nexus (pas de root password en prod)
- Fail2ban basique
- Mises à jour automatiques `unattended-upgrades`
- Snapshots Hostinger automatisés (~6 €/mois pour quotidien — à reconsidérer)

## TODO ops avant J9

1. Audit firewall UFW (laisser 22, 80, 443 + ports n8n existants ; bloquer le reste)
2. Création utilisateur non-root pour Nexus
3. Stratégie de backup : snapshots Hostinger + dump pg_dump quotidien vers
   un bucket S3-compatible (à arbitrer)
4. Procédure de restore documentée (testée au moins une fois sur le snapshot existant)
