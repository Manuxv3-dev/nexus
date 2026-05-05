# ADR-017 : Pattern RPC entre serveur HTTP et workers bridges via Redis

**Date** : 2026-05-01
**Statut** : Remplacé par ADR-027 (2026-05-04)

> ⚠️ **Obsolète depuis le 2026-05-04** : le pattern RPC Redis acté ici a
> été supprimé avec **ADR-027 (universalisation webview messaging)**. Plus
> de worker bridge → plus de besoin de RPC HTTP↔worker. Les fichiers
> `bridge-rpc.ts`, `bridge-registry.ts`, `event-bus.ts`, `bridge-relay.ts`
> ont été supprimés. Conservé pour historique du raisonnement.

## Contexte

L'ADR-009 (architecture des bridges messageries server-side) impose qu'**un
seul process détienne le client gateway** d'un provider donné. Discord
refuse explicitement deux clients simultanés avec le même bot token, et
les bridges Matrix (mautrix-meta pour Messenger, Baileys pour WhatsApp)
ont les mêmes contraintes pour des raisons différentes (sticky sessions,
pairing à long terme, état chiffré complexe).

Conséquence : le serveur HTTP **ne peut pas** instancier directement le
client provider. Or il a besoin d'exécuter des opérations qui requièrent
un appel live au provider :

- `fetchHistory(channelId, cursor)` — l'historique des messages n'est pas
  persisté côté Nexus en V1, on doit interroger Discord/WhatsApp/Messenger
  à chaque demande
- `sendMessage(channelId, content)` — l'envoi doit passer par le bot
  authentifié qui vit dans le worker

Pendant le développement de J4 (couche front), j'ai d'abord écrit
`DiscordProvider.listChannels()` qui appelait `getDiscordClient()` côté
HTTP. Ça a tout de suite cassé en production locale : le client n'existe
que dans le worker `discord-bridge`.

J'ai d'abord patché `listChannels()` en lisant la table `messaging_channels`
peuplée par le worker via `channel:upsert` events (cf. ADR-009 pub/sub
asymétrique). Mais cette approche ne marche pas pour `fetchHistory` ni
`sendMessage` :

- Persister tout l'historique des messages = gros refactor (table
  `messaging_messages`, dédoublonnage, cursor pagination, etc.) — pas
  envisageable pour V1
- `sendMessage` est par nature une opération synchrone qui doit retourner
  l'ID externe du message créé — pas envisageable de faire ça en pub/sub
  asymétrique

Il faut un **mécanisme requête/réponse** entre le serveur HTTP et le
worker, sur Redis.

## Options envisagées

### Option A — RPC via Redis pub/sub (RETENU)

Topics dédiés :

- `bridge:rpc:<provider>:request` — le HTTP publie une requête `{requestId, op, args}`
- `bridge:rpc:<provider>:reply:<requestId>` — le worker publie la réponse
  `{ok, result}` ou `{ok: false, error}` sur ce channel unique

Côté HTTP : `requestRpc(provider, op, args, timeoutMs)` qui s'abonne au
channel reply, publie la requête, attend la réponse ou timeout 5s.

Côté worker : `serveRpc(provider, handlers)` qui s'abonne au request
topic et dispatche vers les handlers.

**Pros**

- Réutilise l'infra Redis pub/sub déjà en place pour les bridges events
- Pas de nouveau service (pas de gRPC, pas de message queue, pas de RabbitMQ)
- Pattern uniforme : un seul code path pour Discord/WhatsApp/Messenger
- Validation Zod side-by-side : args validés côté worker à l'arrivée,
  result validé côté HTTP à la réception → drift schema impossible
- Timeout côté HTTP → aucune requête ne reste pendante indéfiniment
- Erreur typée propagée : un `AppError('RESOURCE_NOT_FOUND')` côté worker
  est rejouée tel quel côté HTTP, le client reçoit un 404 normal

**Cons**

- Crée un client Redis subscriber jetable par requête HTTP (cas extrême
  N requêtes simultanées = N connexions Redis transitoires) — acceptable
  pour V1, à pooliser en V2 si besoin
- Pas de circuit breaker explicite pour l'instant : si le worker est down
  pendant 5s, toutes les requêtes timeout. Acceptable parce que le worker
  est censé être up 24/7 en prod ; à instrumenter (counter `rpc_timeout`
  par provider) avant de pouvoir circuit-break intelligemment

### Option B — gRPC sur socket TCP local

**Pros** : performance, schémas typés via protobuf, streaming natif
**Cons** : nouvelle stack à apprendre + déployer, fichiers `.proto` à
maintenir, ne réutilise pas Redis qu'on a déjà. Trop lourd pour V1.

### Option C — RabbitMQ / NATS

**Pros** : pattern req/resp first-class, primitives plus riches
**Cons** : infra supplémentaire à déployer + maintenir sur le VPS. Redis
suffit largement à notre échelle (≤ 100 sessions actives en V1).

### Option D — Démarrer un client provider côté HTTP

**Pros** : aucun
**Cons** : Discord refuse 2 connexions gateway avec le même token →
casse le worker. Baileys a la même limitation. Viole l'ADR-009. Rejeté.

## Décision

**Option A**. Module `packages/backend/src/integrations/core/bridge-rpc.ts`
qui expose :

```ts
// Côté HTTP
requestRpc(provider, 'fetchHistory', { sessionId, channelExternalId, ... })
  → Promise<{ messages, nextCursor }>

requestRpc(provider, 'sendMessage', { sessionId, channelExternalId, content })
  → Promise<{ externalMessageId, sentAt }>

// Côté worker
serveRpc('discord', {
  fetchHistory: async (args) => { /* utilise getDiscordClient() */ },
  sendMessage: async (args) => { /* idem */ },
});
```

Les schémas `args` et `result` sont définis dans `RpcOps` du même module
(typés Zod), validés runtime des deux côtés. Pour ajouter une nouvelle op
(ex. `fetchAttachment`, `markAsRead`), on étend `RpcOps` + on ajoute le
handler côté worker.

### Wire format (Redis)

Topics :

- Request : `bridge:rpc:<provider>:request`
- Reply : `bridge:rpc:<provider>:reply:<requestId>`

Envelope request :

```json
{ "requestId": "8c4f...", "op": "fetchHistory", "args": {...} }
```

Envelope response (succès) :

```json
{ "ok": true, "result": {...} }
```

Envelope response (erreur) :

```json
{ "ok": false, "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "details": {...} } }
```

### Codes d'erreur ajoutés

`packages/backend/src/core/errors.ts` :

- `RPC_TIMEOUT` (504) : le worker ne répond pas dans le délai
- `RPC_BRIDGE_UNAVAILABLE` (503) : réservé pour V2 (circuit breaker)

### Garantie d'idempotence

Les ops `fetchHistory` sont idempotentes (lecture seule). `sendMessage`
ne l'est PAS — un retry après timeout pourrait créer un message
dupliqué. **V1 : on accepte ce risque** parce que les timeouts sont rares
en pratique (worker local). En V2, ajouter un client request id pour que
le worker dédoublonne (`messaging_send_log` table avec idempotency-key).

## Conséquences

**Positives**

- Discord pleinement fonctionnel côté HTTP : lecture historique, envoi
  de messages, sans casser l'architecture worker-only
- Pattern réutilisable tel quel pour J7 (WhatsApp Baileys) et J8
  (Messenger mautrix-meta) — il suffit d'enregistrer les handlers RPC
  dans leurs workers respectifs
- Pas de nouvelle infra à déployer (Redis déjà en place)
- Validation Zod end-to-end : un mismatch de schéma fait planter au
  bon endroit (build CI ou test d'intégration), pas en prod

**Négatives**

- Latence RPC : ~50-200ms en dev local, à profiler en prod
- Si le worker est down → 5s d'attente avant timeout côté HTTP. Pas une
  bonne expérience user, à compenser par :
  - Healthcheck `/health` qui vérifie que le worker tourne (à ajouter en
    J3.5 monitoring)
  - Circuit breaker qui répond 503 immédiatement après N timeouts
    consécutifs (V2)
- `sendMessage` non-idempotent : retry possible côté front qui produirait
  un doublon. V2 : idempotency-key + dédoublonnage worker.

**Neutres**

- Le module `bridge-rpc.ts` ajoute ~250 lignes au backend, mais c'est
  isolé et bien testé localement. Tests d'intégration à ajouter en J3.5
  (Redis + worker mock).
- L'API publique du `MessagingProvider` (interface) reste inchangée — le
  worker continue d'instancier des `DiscordProvider` normalement. Seul
  le serveur HTTP délègue désormais via RPC au lieu d'instancier
  directement.

## Implémentation V1 (cette session)

- `bridge-rpc.ts` : helpers `requestRpc`, `serveRpc`, `RpcOps` typés
- `messaging/index.ts` : handlers `/messages` et `POST /messages` utilisent
  `requestRpc` au lieu de `provider.fetchHistory()` / `provider.sendMessage()`
- `discord-bridge.ts` : `serveRpc('discord', { fetchHistory, sendMessage })`
  enregistré au boot du worker
- `errors.ts` : ajout des codes `RPC_TIMEOUT` + `RPC_BRIDGE_UNAVAILABLE`

## V2+ (dette tracée dans backlog)

- Circuit breaker côté HTTP (counter timeouts par provider)
- Idempotency-key sur `sendMessage` (dédoublonnage worker)
- Pool de clients Redis subscribers (un seul subscriber persistant, dispatch
  par requestId interne)
- Tests d'intégration RPC bout-en-bout (Redis + worker stub)
- Métriques : `bridge_rpc_request_total`, `bridge_rpc_duration_seconds`,
  `bridge_rpc_timeout_total` (par provider, par op)

## Références

- ADR-009 : architecture des bridges server-side
- Code : `packages/backend/src/integrations/core/bridge-rpc.ts`
- Pattern testé en bout-en-bout côté Discord ce 2026-05-01 :
  fetchHistory + sendMessage + temps réel WS fonctionnels
