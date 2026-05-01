# Tâche en cours

**Statut** : ✅ J3b (Discord provider + worker) livré. Reste **J3c (propagation events WS) + J3d (tests + récap)** pour clôturer J3.

## J3b — Discord : livré

### Validations finales

- ✅ `pnpm typecheck` propre
- ✅ `pnpm lint` 0 errors (110 warnings préexistants ws code)
- ✅ `pnpm test` 54 unit (+ 17 mapper Discord + 9 OAuth) + 2 fichiers d'intégration en attente Postgres
- ✅ Tous les endpoints REST messaging enregistrés dans le serveur

### Sous-jalons J3b livrés

| ID | Contenu |
|----|---------|
| J3b-1 | `discord.js@^14.16.0` ajouté. `integrations/discord/mapper.ts` : fonctions pures `mapDiscordMessage` + `mapDiscordChannel` + `mapDiscordChannelType` (types structurels `*Like` pour testabilité sans dep discord.js dans les tests). 17 tests : message simple, reply, edit, attachments avec/sans contentType, reactions unicode et custom emoji, channel types (text, dm, group_dm, voice, threads, forum). `client.ts` (singleton Client avec intents). `provider.ts` (DiscordProvider implémentant MessagingProvider). `index.ts` (auto-register dans bridge-registry). |
| J3b-2 | `integrations/discord/oauth.ts` : `buildInstallUrl` (signed state HMAC-SHA256 base sur JWT_REFRESH_SECRET, nonce 16 bytes random, ts), `verifyState` (signature constant-time + TTL 10min), `exchangeCodeForGuildInfo` (échange code POST Discord API). 9 tests : URL bien formée, signature round-trip, mismatch sig, format invalide, expiré, nonce différent à chaque appel, séparation par groupId. |
| J3b-3 | `workers/discord-bridge.ts` : process séparé qui acquiert `lock:bridge:discord`, démarre le client discord.js, reconcileSessions au boot, listeners gateway (MessageCreate/Update/Delete + GuildDelete), subscribe `bridge:control:discord`, graceful shutdown SIGTERM/SIGINT. Scripts npm `dev:worker:discord` + `start:worker:discord`. |
| J3b-4 | `routes/messaging/` : 7 endpoints — GET sessions, DELETE session (admin+), GET install-url (admin+), GET oauth callback (public, signature state vérifiée), GET channels, GET messages?cursor=&limit=, POST messages. Validation Zod en input/output. Anti-leak via `findSessionInGroup`. Plugin enregistré dans server.ts + side-effect import du DiscordProvider. |

### Fichiers ajoutés (J3b)

```
packages/backend/src/
├── integrations/
│   └── discord/
│       ├── mapper.ts                          [J3b-1] mapDiscordMessage/Channel
│       ├── mapper.test.ts                     [J3b-1] 17 tests
│       ├── client.ts                          [J3b-1] singleton discord.js Client
│       ├── provider.ts                        [J3b-1] DiscordProvider classe
│       ├── oauth.ts                           [J3b-2] state signé + exchange code
│       ├── oauth.test.ts                      [J3b-2] 9 tests
│       └── index.ts                           [J3b-1] auto-register provider
├── workers/
│   └── discord-bridge.ts                      [J3b-3] worker singleton
├── routes/
│   └── messaging/
│       ├── schemas.ts                         [J3b-4] schemas Zod
│       └── index.ts                           [J3b-4] plugin Fastify (7 endpoints)
└── server.ts                                  [+ register messagingPlugin + side-effect import discord]

packages/backend/package.json                  [+ discord.js@^14.16.0, scripts dev/start:worker:discord]
```

### Comportement effectif

**Flow d'installation** (côté user) :
1. User Manu va dans son groupe Nexus (admin+), clique "Connecter Discord"
2. Frontend appelle `GET /api/v1/groups/:groupId/messaging/discord/install-url`
3. Backend renvoie une URL `https://discord.com/oauth2/authorize?...&state=<signed>` (state HMAC contient groupId + userId + ts + nonce)
4. Frontend redirige le user vers cette URL
5. Discord montre l'écran d'install (choix du serveur, permissions du bot)
6. User confirme, Discord redirige vers `http://127.0.0.1:3000/api/v1/messaging/discord/oauth/callback?code=...&state=...&guild_id=...`
7. Backend vérifie state (signature + fraîcheur), échange code contre guild info, crée la session Nexus, publish `bridge:control:discord {kind: session:added}`
8. Worker `discord-bridge` reçoit la commande, vérifie que le bot est bien dans le guild, met `status='connected'` en DB

**Worker singleton** :
- Un seul process pour tous les guilds Nexus (cf. ADR-009)
- Lock distribué Redis empêche les doublons en cas de multi-replica
- Listeners gateway publient sur `bridge:event:discord` les events normalisés
- Reconcile au boot : tous les guilds en DB sont vérifiés via `client.guilds.cache`

**Anti-leak** :
- `(provider_type, external_id)` unique → impossible de rattacher un guild à 2 groupes Nexus
- `findSessionInGroup(groupId, sessionId)` scope DB-side avant toute opération
- DELETE session validé admin+ uniquement

**Capabilities Discord** : sendMessage ✅, editMessage ✅, deleteMessage ✅, reactions ✅, attachments ✅, voice ❌ (V2), threads ❌ (V2), presence ✅, typingIndicator ✅.

## Prochaine étape — J3c (propagation events WS, ≈ 2-3 j)

Cf. plan détaillé `.agent/notes/j3-plan.md` (section J3c).

À implémenter :
- **J3c-1** Backend HTTP s'abonne à `bridge:event:*` au boot via `subscribeBridgeEvents`
- **J3c-2** Pour chaque event reçu : resolve `sessionId → groupId → membres` puis broadcast WS
- **J3c-3** WS events typés ajoutés à `@nexus/shared/ws-protocol.ts` : `message:new`, `message:edit`, `message:delete`, `message:reaction`, `history:synced`
- **J3c-4** Tests anti-leak : User A ne reçoit pas les events des sessions d'un groupe dont il n'est pas membre

## Action attendue côté Manu

```bash
cd C:\Users\Manu\claude\nexus\nexus
git add .agent/ packages/backend
git commit -m "feat(backend): J3b Discord provider + worker (ADR-006, ADR-009)

- discord.js@^14 ajouté
- integrations/discord/mapper.ts : fonctions pures mapDiscordMessage/Channel/ChannelType + 17 tests
- integrations/discord/client.ts : singleton client.discord.js avec intents
- integrations/discord/provider.ts : DiscordProvider implémentant MessagingProvider
- integrations/discord/oauth.ts : state HMAC + exchange code + 9 tests
- integrations/discord/index.ts : auto-register dans bridge-registry
- workers/discord-bridge.ts : worker singleton avec lock distribué + listeners gateway
- routes/messaging : 7 endpoints (sessions CRUD, install-url, oauth callback, channels, messages send/list)
- server.ts : register messagingPlugin + side-effect import du DiscordProvider"
git push
```

## Pré-requis avant J3c

- [x] J3b livré
- [ ] Manu a son `.env` rempli avec les valeurs Discord réelles
- [ ] Manu peut faire un test E2E manuel quand il veut :
  - démarrer Postgres + Redis : `pnpm compose:up`
  - migrer DB : `pnpm --filter @nexus/backend db:migrate`
  - démarrer backend : `pnpm --filter @nexus/backend dev`
  - démarrer worker : `pnpm --filter @nexus/backend dev:worker:discord`
  - obtenir un access token : POST /auth/register puis garder le `accessToken`
  - créer un groupe : POST /groups
  - obtenir l'install URL : GET /groups/:id/messaging/discord/install-url
  - ouvrir l'URL dans un navigateur, choisir un serveur Discord de test, autoriser
  - vérifier que la session est créée en DB (`status=connected`)

## Blockers

Aucun.
