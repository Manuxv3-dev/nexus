# .agent/ — Zone de travail de nexus-dev

Ce dossier est la mémoire **durable** du projet Nexus, maintenue par l'agent
nexus-dev en collaboration avec Manu : décisions, cap produit, procédures.

Depuis la bascule ADLC du 2026-08-01, le **suivi des tâches n'est plus ici** :
la spécification (WHAT), le plan technique (HOW) et le statut d'une tâche
donnée vivent dans son ticket Linear
(<https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7>).

## Index du dossier

```
.agent/
├── README.md           # Ce fichier — index toujours à jour
├── adr/                # Architecture Decision Records (immuables une fois acceptés)
├── skills/             # Patterns et procédures réutilisables (lus avant d'agir)
├── notes/              # Brouillons, recherches, contexte non structuré
├── roadmap.md          # Cap produit et priorisation long terme
├── archive/            # Suivi de tâches d'avant ADLC, figé
├── backlog.md          # GELÉ — pointeur vers Linear
└── current-task.md     # GELÉ — pointeur vers Linear
```

## ADR fondateurs (validés 2026-04-30 — immuables)

| ID  | Titre                                                                 | Statut                         |
| --- | --------------------------------------------------------------------- | ------------------------------ |
| 001 | Structure monorepo : pnpm workspaces + Turborepo                      | Accepté                        |
| 002 | ORM : Drizzle plutôt que Prisma                                       | Accepté                        |
| 003 | WebSocket : `ws` + protocole maison typé via @nexus/shared            | Accepté                        |
| 004 | Authentification : JWT access court + refresh httpOnly                | Accepté                        |
| 005 | Stratégie multi-tenant : groupId dès le départ, pas de tenantId V1    | Accepté                        |
| 006 | Intégration Discord : API officielle (bot + OAuth user)               | Remplacé par ADR-027           |
| 007 | Intégration Messenger : bridge mautrix-meta server-side               | Remplacé par ADR-022           |
| 008 | Intégration WhatsApp : bridge Baileys server-side                     | Remplacé par ADR-022           |
| 009 | Architecture des bridges messageries — server-side, client agnostique | Remplacé par ADR-027           |
| 010 | Killer features via liens Nexus partagés — pas d'auto-envoi           | Accepté (renforcé par ADR-027) |

## ADR infrastructure et web-first (validés 2026-05-01 — immuables)

| ID  | Titre                                                                            | Statut               |
| --- | -------------------------------------------------------------------------------- | -------------------- |
| 011 | Pipeline CI/CD — GitHub Actions → GHCR → VPS via SSH                             | Accepté              |
| 012 | Topologie VPS prod — Caddy + backend + workers + Postgres + Redis                | Accepté              |
| 013 | Migrations DB en prod — pattern expand/contract                                  | Accepté              |
| 014 | Web app prioritaire — restructuration monorepo + couche `platform`               | Accepté              |
| 015 | Auth web — refresh token httpOnly cookie + CSRF token                            | Accepté              |
| 016 | Implémentation du design system Nexus (bundle handoff)                           | Accepté              |
| 017 | Pattern RPC bridge ↔ HTTP via Redis pub/sub                                      | Accepté              |
| 018 | Stratégie de rendu Open Graph (Satori + cache + report SSR J9)                   | Accepté              |
| 019 | Migration design system EasyTicket                                               | Remplacé par ADR-021 |
| 020 | Worker BullMQ pour les rappels d'events                                          | Accepté              |
| 021 | Design System v2 — true Apple System Colors                                      | Accepté              |
| 022 | Messenger/WhatsApp = encapsulation webview Tauri (modèle Franz)                  | Accepté              |
| 023 | Système de notifications transverses (V1.2)                                      | Accepté              |
| 024 | Home Nexus + préférence d'atterrissage post-login                                | Accepté              |
| 025 | Encapsulation WhatsApp/Messenger — Phase A (placeholder web)                     | Accepté              |
| 026 | Shell desktop Tauri 2 — Phase B encapsulation WA/Messenger                       | Accepté              |
| 027 | Universalisation webview messaging (Discord 100% webview + 9 nouveaux providers) | Accepté              |
| 028 | Sessions messageries scopées USER (pas GROUP)                                    | Accepté              |
| 029 | Activity log append-only (Bloc E HomeDashboard)                                  | Accepté              |
| 030 | Reverse proxy = Traefik existant (amende ADR-012)                                | Accepté              |
| 031 | Pipeline de release desktop Tauri (Windows V1)                                   | Accepté              |
| 032 | Abandon du détecteur d'intention Claude (J6)                                     | Accepté              |
| 033 | Gestion du compte utilisateur (profil, mot de passe, suppression RGPD)           | Accepté              |
| 034 | Préférences de notification par utilisateur                                      | Accepté              |

## Skills disponibles

| Fichier                           | Quand l'utiliser                                  |
| --------------------------------- | ------------------------------------------------- |
| `create-api-endpoint.md`          | Ajouter un endpoint REST Fastify                  |
| `add-websocket-event.md`          | Ajouter un événement temps réel                   |
| `integrate-messaging-platform.md` | Brancher une nouvelle messagerie                  |
| `use-claude-api.md`               | ⚠️ DÉPRÉCIÉ (ADR-032) — intent detector abandonné |
| `use-auth-web.md`                 | Consommer l'auth web (cookie + CSRF) côté front   |
| `regenerate-icons.md`             | Regen toutes les icônes depuis les SVG masters    |

## Conventions

- ADR numérotés séquentiellement, immuables une fois acceptés. Pour modifier
  une décision, on crée un nouvel ADR qui remplace l'ancien (`Remplacé par ADR-XYZ`).
- Skills : un skill par procédure. Mis à jour quand un pattern se répète ou
  qu'une procédure devient non triviale.
- **Dettes techniques** : tracées en ticket Linear, plus dans un fichier. Une
  dette introduite sans ticket est une dette perdue.
- **Suivi de tâches** : dans les tickets. Ne pas réintroduire de fichier
  d'avancement — deux sources qui décrivent le même état divergent toujours.

## Démarrage

État du produit et prochaines étapes : `roadmap.md`, puis le projet Linear pour
ce qui est actionnable. L'historique de développement d'avant ADLC (bilans de
sessions, état live de la prod, décisions de release) est figé dans
`archive/`.

Pour modifier une décision actée, créer un nouvel ADR qui remplace l'existant
(`Statut: Remplacé par ADR-XYZ`).
