# ADR-003 : WebSocket — `ws` + protocole maison typé via @nexus/shared

**Date** : 2026-04-30
**Statut** : Accepté

## Contexte

Nexus a besoin de temps réel pour : nouveaux messages, présence, typing
indicators, événements de groupe (RSVP, sondages, dépenses, todos). Les
événements de référence sont déjà spécifiés dans les instructions projet
(`message:new`, `presence:update`, `event:rsvp`, etc.).

Contraintes :
- Bas couplage côté Tauri (pas de polyfills lourds)
- Typage end-to-end (TS backend ↔ TS desktop)
- Pas de fallback long-polling nécessaire (clients desktop/mobile, pas web mobile très contraint)
- Pub/sub multi-instance prévu (Redis) pour scaler horizontalement plus tard

## Options envisagées

### 1. Socket.IO
- **Pros** : rooms intégrées, reconnexion automatique, adaptateur Redis natif, fallback long-polling
- **Cons** :
  - Protocole maison (pas du WebSocket standard) — surface d'API plus large
  - Bundle plus lourd côté client
  - Typage des événements correct mais perfectible
  - Fallback long-polling inutile dans notre contexte

### 2. `ws` (bibliothèque WebSocket bas niveau)
- **Pros** : minimaliste, performant, WebSocket pur, intégration Fastify via `@fastify/websocket`
- **Cons** : il faut concevoir son propre protocole (auth, ack, rooms, pub/sub Redis)

### 3. tRPC subscriptions
- **Pros** : typage end-to-end superbe, ergonomie de DX
- **Cons** : couple fort côté codebase, moins idiomatique pour des événements broadcast multi-clients, plus difficile à exposer à des clients tiers (mobile RN, futurs clients)

## Décision

**`ws` (via `@fastify/websocket`)** avec un protocole maison typé.

Conception du protocole :
```ts
// packages/shared/src/ws-protocol.ts
type WsEvent =
  | { type: 'message:new'; payload: MessagePayload; groupId: string; timestamp: number }
  | { type: 'presence:update'; payload: PresencePayload; timestamp: number }
  | { type: 'event:rsvp'; payload: EventRsvpPayload; groupId: string; timestamp: number }
  | ... // schéma Zod en source de vérité
```

- Validation Zod systématique en entrée et sortie côté backend
- Côté client, un store Zustand (`useWsStore`) consomme les events typés
- Authentification : JWT passé en query param à la connexion (`wss://.../ws?token=...`),
  validé une seule fois, l'identité est attachée à la `WebSocket` instance
- Pub/sub Redis (via `ioredis`) : chaque instance backend écoute les channels
  `group:{groupId}` et relaie aux clients connectés à ce groupe
- Reconnexion : côté client uniquement (lib `reconnecting-websocket` minuscule)
- Heartbeat : ping/pong toutes les 30s, déconnexion si pas de pong sous 60s

## Conséquences

**Positif** :
- Surface d'API réduite, code lisible, tout est typé
- Bundle client minimal (`ws` côté serveur, WebSocket natif côté client)
- Scalabilité horizontale prête dès le départ via Redis pub/sub
- Schéma d'événements partagé via `@nexus/shared` — tout drift est un build error

**Négatif** :
- Pas de rooms "magiques" : on les implémente nous-mêmes (mappings `groupId → Set<WebSocket>`)
- Reconnexion à gérer côté client (mais une lib légère règle 80% du problème)

**Neutre** :
- Le protocole maison est documenté dans le skill `add-websocket-event.md`
- Si on voulait un jour exposer des WebSocket à des intégrations tierces (peu probable),
  le format est standard et auto-documenté via Zod
