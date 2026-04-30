# Backlog Nexus — tâches en attente, idées, dettes

Mis à jour : 2026-04-30 (rév. 3 : bascule bridges server-side, VPS rouge à nouveau).

Format : `[priorité] description — contexte` où `priorité` ∈ {🔴 blocker, 🟠 haute, 🟡 moyenne, 🟢 faible}.

## Blockers (à résoudre avant déploiement V1)

- ✅ **vps-inventory** — Résolu 2026-04-30. KVM 2 Hostinger, Ubuntu 24.04,
  2 vCPU, 8 Go RAM, 100 Go disque, France/Paris. Largement dimensionné. État
  détaillé dans `.agent/notes/vps-hostinger.md`.
- 🔴 **valider le pack d'ADR fondateurs (001-010)** — validation groupée par
  Manu requise avant de démarrer le J0. Spécialement attention sur :
  - ADR-007/008 (assomption du risque ToS Meta)
  - ADR-009 (architecture bridges server-side)
  - ADR-010 (interdiction d'auto-envoi)
- 🔴 **POC Conduit + mautrix-meta** — à faire en début de J8 avant déploiement
  prod. Si Conduit pose un problème de compat, fallback Synapse (RAM x2).

## Haute priorité (à intégrer dès le début de l'implémentation)

- 🟠 Décider du gestionnaire de secrets (env file `.env` pour MVP suffisant ;
  Doppler / Infisical / Vault à reconsidérer si on ouvre l'équipe).
- 🟠 Politique de logs : que loguer (jamais de PII messages bridgés en clair),
  rotation, durée de rétention.
- 🟠 Politique de purge des messages bridgés (proposition par défaut : 30 jours).
- 🟠 CI : configurer un cache pour `pnpm install` et Turborepo remote cache
  (gratuit jusqu'à un certain volume).
- 🟠 Procédure d'astreinte légère pour les bridges Messenger/WhatsApp :
  qui regarde quand un bridge tombe, comment alerter Manu.
- 🟠 Rotation de la clé `PROVIDER_SESSIONS_KEY` (chiffrement sessions
  bridges) — procédure documentée avant J9.
- 🟠 **vps-cohabitation-n8n** — au déploiement V1 (J9), organiser la cohabitation
  Nexus/n8n : reverse proxy partagé (vhosts), allocation des ports, séparation
  des bases de données, durcissement firewall UFW. Documenter dans
  `docker-compose.prod.yml`.
- 🟠 Audit firewall UFW du VPS (actuellement 0 règles côté Hostinger), création
  utilisateur non-root, désactivation login root par mot de passe, fail2ban —
  à faire avant J9.

## Moyenne priorité (à reprendre après MVP)

- 🟡 Skill `auth-refresh-flow.md` à rédiger quand on implémentera J1 (auth)
- 🟡 Skill `integrate-bridge-discord.md` à rédiger pendant J3
- 🟡 Skill `integrate-bridge-baileys.md` à rédiger pendant J7
- 🟡 Skill `integrate-bridge-mautrix.md` à rédiger pendant J8
- 🟡 Skill `add-public-page-route.md` à rédiger pendant J5
- 🟡 Skill `add-tenant-scoped-table.md` quand on commencera à multiplier les
  tables (rappel ADR-005)
- 🟡 Audit "prêt-multi-tenant" en fin de MVP (J9)
- 🟡 Évaluer la mise en place d'OpenTelemetry / un APM léger (Tempo / Grafana)
  une fois la prod stable
- 🟡 Internationalisation (i18n) — démarrer en français uniquement, prévoir
  l'extraction des chaînes desktop dès J4 pour ne pas avoir à refacto
- 🟡 Smoke test prod quotidien : healthcheck de chaque bridge, alerte si
  KO > 5 min (cf. ADR-009)
- 🟡 Plan de rotation périodique des clés de chiffrement sessions

## Faible priorité / idées à conserver

- 🟢 Nexus comme client Matrix natif — pivot envisageable en V2+
  (l'archi avec Conduit + mautrix-* facilite la transition)
- 🟢 Plugin marketplace pour intégrations tierces (Spotify partagé, Strava
  groupe, etc.)
- 🟢 Mode "vacances" : tableau de bord d'un voyage groupe (events + dépenses +
  todos + photos partagées)
- 🟢 Export d'un groupe vers JSON (RGPD + sauvegarde personnelle)
- 🟢 Mode hors ligne basique côté desktop (cache TanStack Query persistent)
- 🟢 Raccourcisseur d'URL maison (`nx.app/e/abc`) pour des liens plus courts
  dans les messageries
- 🟢 Universal Links / App Links iOS+Android (V2.0 mobile)
- 🟢 Acheter un domaine custom pour Nexus (ex: `nexus.app`, `nexusapp.fr`)
  une fois la V1 stable — pour le MVP on reste sur `srv1068104.hstgr.cloud`

## Dettes techniques tracées

(vide — à remplir au fil de l'implémentation, par convention chaque dette doit
référencer le commit / la PR qui l'introduit)

## Questions ouvertes

- Faut-il un bot Discord slash-commands pour piloter Nexus depuis Discord ?
  (ex: `/nexus event create`) — à reconsidérer après J5
- Stratégie de notifications push mobile en V2 — APNs / FCM via Expo ?
- Faut-il un onboarding guidé dans le desktop (J4) ou on assume que Manu et
  ses amis le testent en mode "tech demo" ?
- Open Graph cards : générer côté backend Node (Satori) ou via service tiers
  (@vercel/og en self-hosted, ou cloudinary) ? Décision pendant J5.
- Cas du téléphone WhatsApp éteint : politique de notification utilisateur,
  fréquence du healthcheck, message d'erreur user-friendly.
- ADR-010 : faut-il prévoir un mode "post automatique opt-in explicite" pour
  les utilisateurs qui veulent ce comportement ? Si oui, dans quel ADR
  successeur, et avec quelles garanties ToS ?
