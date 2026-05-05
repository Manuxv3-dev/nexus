# ADR-009 : Architecture des bridges messageries — server-side, client agnostique

**Date** : 2026-04-30 (rév. 2 : remplace l'ADR-009 v1 sur webview-injection, abandonné)
**Statut** : Remplacé par ADR-027 (2026-05-04)

> ⚠️ **Obsolète depuis le 2026-05-04** : l'architecture serveur acté ici
> (workers bridges + interface `MessagingProvider` + Redis pubsub) a été
> entièrement supprimée par **ADR-027 (universalisation webview
> messaging)**. Le pendule revient à la philosophie de l'ADR-009 v1
> (webview), mais cette fois pour TOUS les providers (Discord/WA/Messenger
> + 9 autres), avec Tauri 2 comme base technique. Conservé pour
> historique du chemin parcouru.

## Contexte

L'ADR-009 v1 décrivait un pattern webview-injection côté desktop pour Messenger
et WhatsApp. Cette voie a été abandonnée suite aux trois exigences posées par
Manu :
- Envoi de messages possible depuis Nexus pour toutes les plateformes
- Killer features fonctionnelles partout
- Parité mobile/desktop

Le webview-injection n'a pas d'équivalent viable sur mobile (iOS sandbox
strict, Android moins fiable, divergence d'archi inacceptable). On bascule
sur des bridges **côté serveur** pour Messenger (cf. ADR-007) et WhatsApp
(cf. ADR-008).

Cet ADR définit le pattern technique commun à **tous** les providers de
messagerie (Discord, WhatsApp, Messenger, et ceux à venir) : structure du
worker, interface, stockage des sessions, monitoring, scaling, sécurité.

## Architecture cible

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                      Clients (desktop, mobile)                  │
│   - Tauri React + Zustand + TanStack Query                      │
│   - React Native (V2)                                           │
│   - Consomment exclusivement l'API Nexus                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + WSS (JWT)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    @nexus/backend (Fastify API)                 │
│   - Routes /api/v1                                              │
│   - WebSocket protocol typé (cf. ADR-003)                       │
│   - Moteur de coordination (intent detection, etc.)             │
│   - Ne sait pas par quel provider un message arrive             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ via tables `messages`, BullMQ events
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Workers Bridges (BullMQ)                       │
│  ┌──────────────┬──────────────┬───────────────────────────────┐│
│  │ Discord      │ WhatsApp     │ Messenger                     ││
│  │ discord.js   │ Baileys      │ mautrix-meta + Conduit        ││
│  │ ~80 Mo RAM   │ ~150 Mo RAM  │ ~550 Mo RAM (bridge+homeserver)││
│  └──────┬───────┴──────┬───────┴────────────┬──────────────────┘│
└─────────┼──────────────┼────────────────────┼───────────────────┘
          │              │                    │
          ▼              ▼                    ▼
   Discord API     WhatsApp servers      Meta servers
```

### Interface unifiée — `MessagingProvider`

Tous les bridges implémentent la même interface (déjà esquissée dans le skill
`integrate-messaging-platform.md`, à finaliser en J3) :

```ts
// packages/shared/src/messaging/provider.ts
export interface MessagingProvider {
  readonly name: 'discord' | 'whatsapp' | 'messenger';

  /** Établit la connexion à partir d'une session stockée */
  connect(session: ProviderSession): Promise<ConnectedProvider>;

  /** Coupe proprement, libère les ressources */
  disconnect(connection: ConnectedProvider): Promise<void>;

  /** Récupère l'historique paginé d'un canal */
  fetchHistory(
    connection: ConnectedProvider,
    channelId: string,
    cursor?: string
  ): Promise<HistoryPage>;

  /** Envoie un message texte tapé par l'utilisateur */
  sendMessage(
    connection: ConnectedProvider,
    channelId: string,
    body: SendMessageBody
  ): Promise<{ externalId: string; sentAt: number }>;

  /** Souscription temps réel (callback à chaque event) */
  subscribe(
    connection: ConnectedProvider,
    onEvent: (e: ProviderEvent) => void
  ): () => void;

  /** Liste des canaux/conversations accessibles */
  listChannels(connection: ConnectedProvider): Promise<ProviderChannel[]>;

  /** Membres d'un canal */
  getMembers(
    connection: ConnectedProvider,
    channelId: string
  ): Promise<ProviderMember[]>;
}
```

L'API Nexus et le moteur de coordination ne dépendent **que** de cette
interface, pas des libraries propriétaires. Si Baileys est remplacé un jour
par mautrix-wa (cf. fallback ADR-008), le code consommateur ne change pas.

### Workers BullMQ — un worker par "type" de bridge

```
packages/backend/src/integrations/
├── core/
│   ├── provider.ts             # interface MessagingProvider (re-export shared)
│   ├── session-store.ts        # CRUD sessions chiffrées en DB
│   ├── encryption.ts           # AES-GCM helpers
│   ├── bridge-registry.ts      # mapping name → factory de provider
│   └── event-bus.ts            # bus interne entre bridges et le backend API
├── discord/
│   ├── provider.ts             # implémente MessagingProvider via discord.js
│   ├── worker.ts               # worker BullMQ qui maintient les gateways
│   ├── mapper.ts               # Discord events → ProviderEvent normalisé
│   └── routes.ts               # OAuth bot register, etc.
├── whatsapp/
│   ├── provider.ts             # via Baileys
│   ├── worker.ts               # un sous-process Node par session active
│   ├── mapper.ts
│   └── routes.ts               # QR code pairing flow
└── messenger/
    ├── provider.ts             # client Application Service Matrix
    ├── worker.ts               # ingestion events Matrix vers ProviderEvent
    ├── mapper.ts
    └── routes.ts               # consentement, login flow Meta
```

Chaque worker est un **processus séparé** (PM2 ou Docker Compose service),
pas un thread du process Fastify principal :
- Robustesse : un crash bridge n'abat pas l'API
- Restart indépendant possible
- Scaling horizontal : plusieurs instances pour un bridge si besoin
- Restart sans déconnecter les WS clients

### Communication entre composants

| Direction                      | Mécanisme                                                                     |
|--------------------------------|-------------------------------------------------------------------------------|
| Client → Backend API           | HTTPS REST + WSS                                                              |
| Backend API → Worker bridge    | BullMQ queue (`bridge:${provider}:send`, `bridge:${provider}:fetch-history`)  |
| Worker bridge → Backend API    | Redis pub/sub (`bridge:events`) + insertion en DB                             |
| Backend API → Client (WS)      | Redis pub/sub (`group:${groupId}`) → fan-out par instance backend             |

### Stockage des sessions et secrets

Toutes les sessions des providers sont stockées en DB dans la table
`messaging_provider_sessions` :

```ts
// schema simplifié
{
  id: uuid,
  groupId: uuid,           // multi-tenant ready (ADR-005)
  provider: 'discord' | 'whatsapp' | 'messenger',
  externalIdentity: text,  // user discord, jid WA, etc.
  encryptedData: bytea,    // sérialisation chiffrée AES-GCM des creds + state
  status: 'active' | 'pairing' | 'broken' | 'revoked',
  lastSeenAt: timestamp,
  createdAt, updatedAt
}
```

Clé de chiffrement (AES-GCM 256) en env (`PROVIDER_SESSIONS_KEY`), jamais
loguée, jamais commit. Rotation prévue mais hors scope MVP (procédure
documentée dans le backlog).

### Monitoring

Pour chaque worker bridge :
- `provider:${name}:up` — booléen, exposé sur un endpoint healthcheck
- `provider:${name}:sessions:active` — gauge
- `provider:${name}:events:in` — counter (events reçus du provider)
- `provider:${name}:events:out` — counter (messages envoyés au provider)
- `provider:${name}:errors` — counter (avec tag de type d'erreur)
- `provider:${name}:lag_ms` — histogramme (latence event reçu → propagé en WS Nexus)

Format pino structuré, agrégation MVP via fichier + lecture manuelle.
OpenTelemetry / Prometheus en backlog moyenne priorité.

### Sécurité

- **Whitelist des opérations exposées** par chaque worker via la queue BullMQ.
  Les workers n'écoutent que des types de jobs précis (`send`, `fetch-history`,
  `disconnect`, `pair`).
- **Pas de credentials en clair en RAM** plus longtemps que nécessaire :
  déchiffrement à la connexion, état runtime garde les clés Signal chiffrées
  jusqu'à usage.
- **Isolation par groupe** : un worker ne traite que les sessions du groupe
  qu'on lui demande. Pas de cross-group leak possible (cf. ADR-005).
- **Rate limiting envoi** : 30 msg/min/session par défaut, paramétrable. Pour
  ressembler à un humain et limiter le risque de ban (cf. ADR-007/008).
- **Healthcheck mutuel** : le backend API marque une session "broken" si le
  worker correspondant ne pulse plus. Notification utilisateur côté UI.

### Scaling et restart

- **Restart d'un worker** : la session se reconnecte à partir de l'état chiffré
  en DB. Pas de re-pairing utilisateur sauf si le provider a invalidé la session.
- **Scaling horizontal** : plusieurs instances du même worker sont possibles,
  BullMQ distribue les jobs. Chaque session est sticky à une instance via un
  lock Redis (évite les double-connexions au provider).
- **Failover** : si une instance worker meurt, le lock Redis expire (TTL 60s),
  une autre instance reprend la session.

## Conséquences

**Positif** :
- Architecture cohérente, lisible, testable
- Clients (desktop et mobile) totalement agnostiques des providers
- Parité desktop/mobile garantie : on n'a pas deux codes à maintenir
- Bridges isolés, redémarrables indépendamment, scalables
- Si un provider est compromis ou retiré, les autres tournent
- Préparation au multi-tenant via `groupId` partout (cf. ADR-005)

**Négatif** :
- VPS plus chargé qu'avec l'option webview : ~700-800 Mo de RAM dédiés aux
  bridges (Discord + WhatsApp + Messenger). Le **blocker `vps-inventory`
  redevient rouge** — il faut soit confirmer que le VPS actuel a 4-8 Go libres,
  soit upgrader.
- Maintenance des bridges = travail récurrent (estimation : 1-2 j/mois en
  rythme de croisière, plus en cas d'incident Meta)
- Setup ops plus lourd au déploiement V1

**Neutre** :
- Skills à créer au fil de l'implémentation : `integrate-bridge-discord.md`
  (J3), `integrate-bridge-baileys.md` (J7), `integrate-bridge-mautrix.md` (J8)
- L'ADR-009 v1 (webview-injection) est conservé dans l'historique git mais
  remplacé par cette v2

## Action requise de Manu

✅ Validé en discussion — passage en "Accepté" lors de la validation
groupée des ADR.
