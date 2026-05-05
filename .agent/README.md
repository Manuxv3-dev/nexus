# .agent/ — Zone de travail de nexus-dev

Ce dossier est la mémoire vivante du projet Nexus, maintenue par l'agent
nexus-dev en collaboration avec Manu. Tout ce qui ne relève pas du code
applicatif passe par ici : décisions, roadmap, contexte, skills.

## Index du dossier

```
.agent/
├── README.md           # Ce fichier — index toujours à jour
├── adr/                # Architecture Decision Records (immuables une fois acceptés)
├── skills/             # Patterns et procédures réutilisables (lus avant d'agir)
├── notes/              # Brouillons, recherches, contexte non structuré
├── roadmap.md          # Roadmap vivante avec statut des jalons
├── backlog.md          # Tâches en attente, idées, dettes techniques
└── current-task.md     # Tâche en cours, état d'avancement, blockers
```

## ADR fondateurs (validés 2026-04-30 — immuables)

| ID  | Titre                                                  | Statut   |
|-----|--------------------------------------------------------|----------|
| 001 | Structure monorepo : pnpm workspaces + Turborepo       | Accepté  |
| 002 | ORM : Drizzle plutôt que Prisma                        | Accepté  |
| 003 | WebSocket : `ws` + protocole maison typé via @nexus/shared | Accepté  |
| 004 | Authentification : JWT access court + refresh httpOnly | Accepté  |
| 005 | Stratégie multi-tenant : groupId dès le départ, pas de tenantId V1 | Accepté  |
| 006 | Intégration Discord : API officielle (bot + OAuth user) | Remplacé par ADR-027 |
| 007 | Intégration Messenger : bridge mautrix-meta server-side | Remplacé par ADR-022 |
| 008 | Intégration WhatsApp : bridge Baileys server-side       | Remplacé par ADR-022 |
| 009 | Architecture des bridges messageries — server-side, client agnostique | Remplacé par ADR-027 |
| 010 | Killer features via liens Nexus partagés — pas d'auto-envoi | Accepté (renforcé par ADR-027) |

## ADR infrastructure et web-first (validés 2026-05-01 — immuables)

| ID  | Titre                                                  | Statut   |
|-----|--------------------------------------------------------|----------|
| 011 | Pipeline CI/CD — GitHub Actions → GHCR → VPS via SSH   | Accepté  |
| 012 | Topologie VPS prod — Caddy + backend + workers + Postgres + Redis | Accepté  |
| 013 | Migrations DB en prod — pattern expand/contract        | Accepté  |
| 014 | Web app prioritaire — restructuration monorepo + couche `platform` | Accepté  |
| 015 | Auth web — refresh token httpOnly cookie + CSRF token  | Accepté  |
| 016 | Implémentation du design system Nexus (bundle handoff) | Accepté  |
| 017 | Pattern RPC bridge ↔ HTTP via Redis pub/sub            | Accepté  |
| 018 | Stratégie de rendu Open Graph (Satori + cache + report SSR J9) | Accepté  |
| 019 | Migration design system EasyTicket                       | Remplacé par ADR-021 |
| 020 | Worker BullMQ pour les rappels d'events                  | Accepté  |
| 021 | Design System v2 — true Apple System Colors              | Accepté  |
| 022 | Messenger/WhatsApp = encapsulation webview Tauri (modèle Franz) | Accepté  |
| 023 | Système de notifications transverses (V1.2)            | Accepté  |
| 024 | Home Nexus + préférence d'atterrissage post-login      | Accepté  |
| 025 | Encapsulation WhatsApp/Messenger — Phase A (placeholder web) | Accepté  |
| 026 | Shell desktop Tauri 2 — Phase B encapsulation WA/Messenger | Accepté  |
| 027 | Universalisation webview messaging (Discord 100% webview + 9 nouveaux providers) | Accepté  |
| 028 | Sessions messageries scopées USER (pas GROUP) | Accepté  |

## Skills disponibles

| Fichier                          | Quand l'utiliser                                   |
|----------------------------------|----------------------------------------------------|
| `create-api-endpoint.md`         | Ajouter un endpoint REST Fastify                   |
| `add-websocket-event.md`         | Ajouter un événement temps réel                    |
| `integrate-messaging-platform.md`| Brancher une nouvelle messagerie                   |
| `use-claude-api.md`              | Appels à l'API Claude (intent detection, etc.)     |
| `use-auth-web.md`                | Consommer l'auth web (cookie + CSRF) côté front    |
| `regenerate-icons.md`            | Regen toutes les icônes depuis les SVG masters     |

## Conventions

- ADR numérotés séquentiellement, immuables une fois acceptés. Pour modifier
  une décision, on crée un nouvel ADR qui remplace l'ancien (`Remplacé par ADR-XYZ`).
- Skills : un skill par procédure. Mis à jour quand un pattern se répète ou
  qu'une procédure devient non triviale.
- `current-task.md` : mis à jour au fil de l'eau pour permettre à n'importe qui
  (Manu, ou nexus-dev dans une session future) de reprendre le travail.
- `backlog.md` : toute dette technique introduite y est tracée explicitement.

## Démarrage

État actuel (2026-05-04) : **J0 → J5b livrés + ADR-027 universalisation
webview messaging implémentée** :

- Backend simplifié : suppression complète des bridges (worker Discord,
  RPC Redis, channel-store, event-bus). Seuls workers restants =
  `event-reminders` + `notifications-purge` (BullMQ, killer features).
- Frontend : tous les providers (Discord/WhatsApp/Messenger + 9 nouveaux
  Telegram/Instagram/Slack/Teams/LinkedIn/X/Reddit/TikTok/Snapchat) sont
  encapsulés en webview Tauri sur desktop, placeholder + window.open sur
  web pur. UI Settings unifiée (12 ConnectionCards data-driven).
- DB : migration 0007 étend `provider_type` enum à 12 valeurs.
- 5 ADR sont désormais marqués obsolètes ou remplacés (ADR-006, 007, 008,
  009, 017) — l'architecture serveur des bridges est officiellement morte.

Reste : V1.2 notifications transverses producteurs (cf. memory + ADR-023),
test E2E manuel des 12 providers Tauri, et l'éventuelle 13ᵉ messagerie
demandera juste : un logo BrandIcon + une URL `PROVIDER_WEB_URL` + une
entrée DB enum (procédure documentée à venir dans
`.agent/skills/add-webview-provider.md`).

Pour modifier une décision actée, créer un nouvel ADR qui remplace l'existant
(`Statut: Remplacé par ADR-XYZ`).
