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
| 006 | Intégration Discord : API officielle (bot + OAuth user) | Accepté  |
| 007 | Intégration Messenger : bridge mautrix-meta server-side | Accepté  |
| 008 | Intégration WhatsApp : bridge Baileys server-side       | Accepté  |
| 009 | Architecture des bridges messageries — server-side, client agnostique | Accepté  |
| 010 | Killer features via liens Nexus partagés — pas d'auto-envoi | Accepté |

## ADR infrastructure et web-first (validés 2026-05-01 — immuables)

| ID  | Titre                                                  | Statut   |
|-----|--------------------------------------------------------|----------|
| 011 | Pipeline CI/CD — GitHub Actions → GHCR → VPS via SSH   | Accepté  |
| 012 | Topologie VPS prod — Caddy + backend + workers + Postgres + Redis | Accepté  |
| 013 | Migrations DB en prod — pattern expand/contract        | Accepté  |
| 014 | Web app prioritaire — restructuration monorepo + couche `platform` | Accepté  |
| 015 | Auth web — refresh token httpOnly cookie + CSRF token  | Accepté  |

## Skills disponibles

| Fichier                          | Quand l'utiliser                                   |
|----------------------------------|----------------------------------------------------|
| `create-api-endpoint.md`         | Ajouter un endpoint REST Fastify                   |
| `add-websocket-event.md`         | Ajouter un événement temps réel                    |
| `integrate-messaging-platform.md`| Brancher une nouvelle messagerie                   |
| `use-claude-api.md`              | Appels à l'API Claude (intent detection, etc.)     |

## Conventions

- ADR numérotés séquentiellement, immuables une fois acceptés. Pour modifier
  une décision, on crée un nouvel ADR qui remplace l'ancien (`Remplacé par ADR-XYZ`).
- Skills : un skill par procédure. Mis à jour quand un pattern se répète ou
  qu'une procédure devient non triviale.
- `current-task.md` : mis à jour au fil de l'eau pour permettre à n'importe qui
  (Manu, ou nexus-dev dans une session future) de reprendre le travail.
- `backlog.md` : toute dette technique introduite y est tracée explicitement.

## Démarrage

État actuel : **Jalons J0/J1/J2 livrés**. Les 15 ADR sont validés et immuables.
Prochain jalon : **J3 — Architecture bridges + Discord** (≈ 1.5-2 sem),
sous-jalon transverse **J3.0 auth web cookie** intégré au début.

Pour modifier une décision actée, créer un nouvel ADR qui remplace l'existant
(`Statut: Remplacé par ADR-XYZ`).
