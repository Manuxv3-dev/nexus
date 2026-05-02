# Tâche en cours

**Statut** : 🟢 Session 2026-05-02 — J5b killer features bout-en-bout livrées.

## Session 2026-05-02 — J5b polish + Expenses + Todos

### Livrés ce passage

- ✅ **#40 Expenses bout-en-bout** : repo + schemas + 7 routes Fastify côté
  backend, hooks TanStack Query + ExpenseModal (split égal/manuel) +
  ExpensesDashboard avec bandeau balances + page publique interactive.
- ✅ **#41 Todos bout-en-bout** : repo + schemas + 9 routes Fastify côté
  backend, hooks + TodoListModal (check/add/delete/assignation inline) +
  TodosDashboard cards avec progress + page publique interactive.
- ✅ **#55 Copier l'ID du groupe** : nouveau menu item dans `GroupMenu`.
- ✅ **#57 Page publique pas auth recognized** : double cause :
  1. `useGroups()` fetchait sans gate sur l'auth (401 silencieux + pas de
     refetch). Fix `enabled: !!userId && !initializing` + queryKey
     incluant userId.
  2. **Bug structurel `AUTH_REFRESH_REUSED`** au boot en dev : React
     StrictMode double-mount → deux POST `/auth/refresh` parallèles avec
     le même refresh token → backend révoque toutes les sessions.
     Fix : déduplication `initInFlight` dans `useAuth.init()`.
- ✅ **Modal stale après mutation killer features** : les 4 dashboards
  stockaient l'objet figé en state. Refactor pour stocker l'ID seulement
  + lookup à chaque render → la modal suit automatiquement les re-fetch
  TanStack Query.

### Backlog killer features J5b (toujours pending)

- **#42** Worker BullMQ rappels Events (24h + 1h avant `startsAt`)
- **#44** Tests d'intégration mutations critiques
- **#43** ADR-019 schéma killer features + ADR-020 palette pastels
- **#45** Vérif finale + commits + push

### Bugs polish encore en attente (non bloquants)

- 🟡 **#53** — bot Discord poste les messages au lieu du user
- 🟡 **#54** — sens de défilement messages (récents en bas)
- 🟡 **#56** — feedback visuel insuffisant boutons popups/cards
- 🟡 **#52** — DS v2 Phase 2 (CVA + Phosphor migration)

## Récap session 2026-05-01 (référence)

**Statut** : ✅ Session 2026-05-01 livrée. Bundle de design implémenté +
flow Discord 100% fonctionnel de bout en bout.

## Récap session 2026-05-01

### Mission

Manu a livré `nexus_design.zip` (bundle de design Claude Design avec 8
écrans HTML + tokens + composants) et a demandé une implémentation
**complète** branchée au backend existant. Cf. ADR-016 pour la décision
structurelle.

Pendant la session, deux problèmes architecturaux sont apparus en testant
de bout en bout, dépassant le scope initial :
1. La table `messaging_channels` n'était jamais peuplée en production
   réelle — le worker n'émettait pas `channel:upsert`. Fix dans cette
   session.
2. Le serveur HTTP appelait `getDiscordClient()` qui n'existe que dans
   le worker → toutes les ops live (fetchHistory, sendMessage) étaient
   cassées. Fix par RPC Redis (cf. ADR-017).

### Packages monorepo créés

| Package                 | Rôle                                                    |
|-------------------------|---------------------------------------------------------|
| `@nexus/platform`       | Interfaces TypeScript des capacités natives (ADR-014)   |
| `@nexus/platform-web`   | Implémentation Web APIs                                  |
| `@nexus/web`            | SPA Vite + React 18 + TS + Tailwind + tokens Neon Dusk  |
| `@nexus/landing`        | Vite static pour `nexusapp.chat` (réutilise web)        |

### Écrans frontend implémentés

- Login, Register, ForgotPassword, Onboarding (auth web cookie+CSRF, ADR-015)
- AppShell 3-pane (groupes / channels / conversation) + MobileShell stack
- ChatView avec composer + WS temps réel
- 4 panels killer features (Event RSVP, Poll, Expense balances, Todo) — données seedées
- 5 pages publiques (`/e /p /d /t /l`) read-only avec CTA inscription
- SettingsScreen 4 sections (profil, notifs, connexions, sécurité)
- LandingScreen (hero, problem, features, how-it-works, waitlist, footer)
- OAuthCallbackScreen (popup OAuth Discord)

### Fonctionnalités fonctionnelles de bout en bout

✅ Inscription / connexion / déconnexion (auth cookie+CSRF)
✅ Onboarding (avatar + créer groupe)
✅ Création de groupes via API
✅ Connexion Discord OAuth (popup + BroadcastChannel cross-tab)
✅ Déconnexion Discord avec modal de confirmation
✅ Pastille couleur sur le rail des groupes pour identifier les sessions actives
✅ Liste des channels Discord (seed worker → DB → API)
✅ Historique des messages (RPC HTTP → worker → Discord API)
✅ Envoi de messages depuis Nexus vers Discord
✅ Réception temps réel WS quand un message arrive sur Discord
✅ Toast de confirmation cross-tab via BroadcastChannel
✅ Settings → Sécurité → "Déconnecter tous les autres appareils"
✅ Settings → Connexions → "Connecter Discord" via popup OAuth
✅ Mobile responsive (< 768px → MobileShell stack)

### Bugs architecturaux backend corrigés en cours de route

1. **OAuth callback rendait du JSON au lieu de rediriger** — fix : vrai
   `reply.redirect(302)` vers le frontend
2. **`createSession` rejetait sur retry OAuth** — fix : idempotent (réutilise
   la session existante si même groupe)
3. **`messaging_channels` jamais peuplée** — fix : worker `seedChannelsForGuild`
   au boot + listeners `ChannelCreate/Update` + bridge-relay upsert DB
4. **`listChannels` HTTP appelait `getDiscordClient()` qui throw** — fix :
   lecture directe DB
5. **Schema sessions front désaligné** (status `active` vs `connecting`) — fix
6. **Schema channels front désaligné** (`externalId` vs `externalChannelId`)  — fix
7. **`channelId` strippé du params** par `defineRoute` (pas dans
   `SessionParamsSchema`) → 400 ZodError sur `channelExternalId` undefined
   — fix : nouveau `ChannelMessagesParamsSchema`
8. **`MessagingMessageDtoSchema.id` strict UUID** rejetait les snowflakes
   Discord — fix : `z.string()` libre (V2 quand on persistera les messages)
9. **Schema messages front désaligné** (`text/sentAt` vs `content/externalCreatedAt`) — fix
10. **`useWs.onEvent` vide** → pas d'invalidation TanStack sur `message:new` —
    fix : invalidation explicite par event type
11. **`fetchHistory` et `sendMessage` HTTP appelaient le client Discord
    inexistant côté HTTP** — fix : RPC bridge ↔ HTTP via Redis (ADR-017)

### ADR rédigés cette session

- **ADR-016** : implémentation du design system Nexus (bundle handoff)
- **ADR-017** : pattern RPC bridge ↔ HTTP via Redis pub/sub

### Fichiers ajoutés

```
packages/backend/src/
├── core/
│   └── errors.ts                              [maj] +RPC_TIMEOUT, +RPC_BRIDGE_UNAVAILABLE
│   └── env.ts                                 [maj] +WEB_BASE_URL
├── integrations/core/
│   ├── bridge-rpc.ts                          [new] requestRpc + serveRpc
│   └── channel-store.ts                       [new] upsert/archive/list messaging_channels
├── integrations/discord/
│   └── provider.ts                            [maj] listChannels lit la DB
├── routes/
│   ├── killer-features/                       [new] stubs J5 (events/polls/expenses/todos)
│   ├── waitlist/                              [new] POST /api/v1/waitlist
│   └── messaging/
│       ├── index.ts                           [maj] callback redirect, idempotent OAuth, RPC fetchHistory/sendMessage
│       └── schemas.ts                         [maj] +ChannelMessagesParamsSchema, MessagingMessageDtoSchema relaxé
├── workers/
│   └── discord-bridge.ts                      [maj] +serveRpc + seedChannelsForGuild + ChannelCreate/Update listeners
└── ws/
    └── bridge-relay.ts                        [maj] persiste channel:upsert en DB

packages/web/                                  [new package complet]
packages/landing/                              [new package complet]
packages/platform/                             [new package complet]
packages/platform-web/                         [new package complet]

.agent/
├── README.md                                  [maj] +ADR-016, +ADR-017
├── backlog.md                                 [maj] +12 dettes techniques tracées
├── current-task.md                            [maj] (ce fichier)
├── adr/
│   ├── ADR-016-design-system-bundle.md        [new]
│   └── ADR-017-bridge-rpc-pattern.md          [new]
```

## Action attendue côté Manu

```bash
cd C:\Users\Manu\claude\nexus\nexus

# Vérifier que tout compile et lint
pnpm typecheck
pnpm lint

# (optionnel) Lancer le smoke test UI complet
pnpm --filter @nexus/backend dev                  # term 1
pnpm --filter @nexus/backend dev:worker:discord   # term 2
pnpm --filter @nexus/web dev                      # term 3

# Commit en plusieurs morceaux propres
git add packages/platform packages/platform-web packages/landing
git commit -m "feat(monorepo): scaffold packages platform + landing (ADR-014)"

git add packages/web
git commit -m "feat(web): SPA Nexus complete — auth + app shell + killer features + landing + mobile"

git add packages/backend/src/routes/killer-features packages/backend/src/routes/waitlist
git commit -m "feat(backend): killer features stubs + waitlist endpoint"

git add packages/backend/src/integrations/core/channel-store.ts \
        packages/backend/src/integrations/core/bridge-rpc.ts \
        packages/backend/src/integrations/discord/provider.ts \
        packages/backend/src/workers/discord-bridge.ts \
        packages/backend/src/ws/bridge-relay.ts \
        packages/backend/src/routes/messaging/ \
        packages/backend/src/core/env.ts \
        packages/backend/src/core/errors.ts
git commit -m "fix(backend): channels persisted in DB + RPC bridge ↔ HTTP for fetchHistory/sendMessage

- Worker discord-bridge seed les channels au boot et sur ChannelCreate/Update
- bridge-relay persiste channel:upsert dans messaging_channels
- DiscordProvider.listChannels lit la DB (plus d'appel client côté HTTP)
- Pattern RPC via Redis pour fetchHistory + sendMessage (ADR-017)
- OAuth callback : redirect HTTP au lieu de JSON, idempotent sur retry
- ChannelMessagesParamsSchema pour ne plus stripper channelId du params
- MessagingMessageDtoSchema : id en string libre (snowflake Discord)
- WEB_BASE_URL ajouté à l'env schema

Cf. .agent/adr/ADR-016 et ADR-017"

git add .agent/
git commit -m "docs(agent): ADR-016 + ADR-017 + maj backlog dettes V2"

git push
```

## Prochaines étapes

### Immédiat (si rééveille un autre jour)

- **J3d (stabilisation J3)** : maj `integrate-messaging-platform.md` skill
  pour intégrer les patterns appris (RPC, seed channels, idempotent
  OAuth) afin que J7 (WhatsApp) et J8 (Messenger) en bénéficient
  directement
- **J3.5 (CI/CD + premier deploy VPS)** : pas commencé. À faire dès
  qu'on veut pouvoir déployer en prod

### V2 / dettes documentées

Cf. `.agent/backlog.md` section "Dettes techniques tracées". Les plus
importantes :
- Idempotency-key sur sendMessage RPC (anti-doublon)
- Circuit breaker bridge-rpc (UX si worker down)
- Tests d'intégration RPC end-to-end
- Schémas Zod partagés via @nexus/shared (au lieu de redéfinir front+back)
- Endpoints J5 : remplacer le store in-memory killer features

## Blockers

Aucun. Discord est fonctionnel de bout en bout et le pattern est
réutilisable pour J7/J8.
