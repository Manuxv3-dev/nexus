# Tâche en cours

**Statut** : ✅ Session 2026-05-05 — SIX lots livrés (V1.2 notifs durcies +
test E2E shell Tauri validé + cleanup dette légère 0010/0011/LS/backlog +
quick win drop encryption.ts + env cleanup + drop colonnes channel_id +
cleanup code routes/queries/AppShell + branding assets pixel-perfect).
À commit + push côté Windows.

## 🎯 Action immédiate côté Manu

```powershell
cd C:\Users\Manu\claude\nexus\nexus

# 0. Cleanup éventuel index.lock orphelin
Remove-Item .git\index.lock -ErrorAction SilentlyContinue

# 1. Migrations cumulées (0009 destructive + 0010 + 0011 additives)
pnpm --filter @nexus/backend db:migrate

# 2. Vérifs (déjà au vert côté agent dans le sandbox)
pnpm --filter @nexus/backend test          # 46 passed | 3 skipped (Postgres absent en sandbox, présent chez toi)
pnpm --filter @nexus/backend typecheck     # clean
pnpm --filter @nexus/web build
pnpm install                               # purge le lockfile au cas où

# 3. Test runtime Tauri rapide (~3 min) :
#    - sessions DB vidées par 0009 — re-connecter un provider depuis Settings
#    - vérifier sidebar, GroupHome, drag&drop reorder (devrait être identique)
#    - vérifier qu'une notif tombe en DB (cloche sidebar) quand un autre user
#      crée un event / ajoute une dépense / m'assigne un todo
#    - reorder sessions : la nouvelle clé `nx:sessionOrder` est user-globale
#      (l'ordre est partagé peu importe le groupe sélectionné)
```

## 📦 Livré ce passage (session 2026-05-05)

### Lot A — V1.2 notifications transverses (durcissement)

Constat : les producteurs étaient déjà branchés en code (le récap session
précédente était pessimiste).

- ✅ **Schémas Zod par kind manquants** : `EventRsvpReceivedPayloadSchema`
       et `TodoCompletedPayloadSchema` ajoutés dans
       `packages/backend/src/routes/notifications/schemas.ts` pour aligner
       les 6 kinds présents dans `NotificationKindSchema` (shared) et
       utilisés dans les routes.
- ✅ **Tests worker `event-reminders`** : 4 nouveaux tests qui couvrent le
       branchement DB (insertNotificationsBulk fan-out, publish
       `notification:created` per recipient, comportement best-effort si
       DB échoue). 9/9 tests passent.

### Lot B — Test E2E shell Tauri (validation manuelle)

| Provider | Pattern d'auth | 7 critères |
|---|---|---|
| Discord | email + 2FA (classique) | ✅✅✅✅✅✅✅ |
| WhatsApp | QR code mobile-tied | ✅✅✅✅✅✅✅ |
| Messenger | login Meta (ToS strict) | ✅✅✅✅✅✅✅ |
| Microsoft Teams | tenant org + rebonds login.microsoftonline.com | ✅✅✅✅✅✅✅ |

**Verdict** : shell Tauri validé pour V1 (data_directory isolé, hide/show
au switch, persistance cookies post-restart, add_child resize). Les 8
autres providers réutilisent les mêmes briques — limitations potentielles
seront propres au provider, pas au shell. Détail dans
[`.agent/notes/e2e-providers-2026-05-05.md`](notes/e2e-providers-2026-05-05.md).

### Lot C — Cleanup dette technique légère

- ✅ **Migration 0010 — drop `messaging_channels` + `messaging_messages`** :
       schema TS retire les 2 tables + l'enum `channel_type`. Drizzle-kit
       génère DROP TABLEs CASCADE + DROP CONSTRAINT FK channel_id dans
       events/polls/expenses/todo_lists + DROP TYPE channel_type. Les
       colonnes `channel_id` orphelines sont conservées (uuid simple sans
       FK, toujours NULL en pratique) — leur drop complet et le cleanup
       du code routes/queries/front sont tracés en dette pour une session
       de refactor dédiée.
- ✅ **Migration 0011 — drop `messaging_provider_sessions.encrypted_credentials`** :
       colonne jamais utilisée depuis ADR-027 (sessions webview-encapsulées
       sans creds serveur). Cleanup `session-store.ts` (retire
       `encryptedCredentials` + `hasCredentials` + `getCredentials` +
       `setCredentials` + customType `bytea`). DTOs Zod backend+web
       retirent `hasCredentials`.
- ✅ **localStorage `nx:sessionOrder` user-global** : la clé devient unique
       (au lieu de scopée par groupId) — cohérent avec ADR-028 (sessions
       user-scoped). Migration legacy : à la 1re lecture, hydrate la
       nouvelle clé depuis la 1re ancienne entrée trouvée + cleanup des
       legacy.
- ✅ **Nettoyage backlog** : section "Frontend SPA" curée — 13 items
       chat-programmable obsolètes retirés (composer, scroll auto,
       attachments, réactions, mentions, dates relatives, pagination,
       doublons, Shift+Enter, erreurs, avatars, pastille multi-providers,
       mobile rail). Conserve 4 items toujours pertinents (bouton +,
       toast bridge, theme persistance, empty states).

### Lot F — Branding & icons (refonte assets pixel-perfect)

Sujet remonté par Manu : icône Nexus pixellisée dans la taskbar Windows.
Décisions Manu : option A (garder triple cercle violet + ajouter une
variante "small-mark" pour ≤24px) + violet `#7c5cfc` + logo unique
dark/light + créer un wordmark.

- ✅ **4 SVG masters** dans `assets/branding/` : `logo-mark.svg` (full
       3 cercles + lignes triangulaires), `logo-mark-small.svg`
       (3 cercles plus gros sans lignes, optimisé small-scale ≤32px),
       `logo-wordmark.svg` ("nexus" font Inter system), `logo-lockup.svg`
       (mark + wordmark côte à côte).
- ✅ **Charte couleurs** documentée : 3 nuances violet (`#7c5cfc`,
       `#a78bfa`, `#c084fc`).
- ✅ **README** dans `assets/branding/` avec règles d'usage (mark full
       ≥32, small ≤32, lockup ≥280, espace de protection).
- ✅ **Script de génération** `scripts/icons-generate.{sh,ps1}` :
       rasterize SVG → PNG pixel-perfect par taille (16/24/32 depuis
       small, 48-1024 depuis full) + assemble icon.ico (7 résolutions),
       copie vers Tauri/web/landing, génère favicon.ico/apple-touch-icon/
       PWA maskable. Dispo bash (mac/Linux/WSL) + PowerShell (Windows pur).
- ✅ **Skill** `.agent/skills/regenerate-icons.md` documente la
       procédure complète + checklist visuelle + pièges connus.
- ✅ **Assets régénérés et placés** :
       - `packages/desktop/src-tauri/icons/icon.ico` (7 tailles
         pixel-perfect : 16, 24, 32, 48, 64, 128, 256)
       - `packages/desktop/src-tauri/icons/*.png` (toutes tailles Tauri)
       - `packages/web/public/{favicon.svg, favicon.ico,
         apple-touch-icon.png, icon-192.png, icon-512.png,
         icon-maskable-512.png, manifest.json}`
       - `packages/landing/public/favicon.svg`
- ✅ **`index.html`** mis à jour avec links favicon multi-formats +
       apple-touch-icon + manifest.json + title "nexus" lowercase.

⚠️ **Limitations sandbox** : `iconutil`/`png2icns` indispo → pas de
`.icns` macOS généré (Manu fera sur mac, ou Tauri CLI le génère au
build). `<text>` du wordmark dépend de la font system au rasterize ;
si rendu PNG du wordmark imparfait, convertir en `<path>` via Inkscape.

⚠️ **Sujet final design pro** ouvert : la variante actuelle (option A)
est pragmatique mais reste "amateur". Externalisation à un designer
(option C, ~50-300€) recommandée avant le launch public V1 pour une
identité durable.

### Lot E — Drop colonnes `channel_id` orphelines + cleanup code

Refactor cross-fichiers attendu ~2-3h, livré.

- ✅ **Schema TS** : retire les 4 colonnes `channelId: uuid('channel_id')`
       dans events/polls/expenses/todoLists.
- ✅ **Migration 0012** générée par drizzle-kit : `ALTER TABLE * DROP
       COLUMN IF EXISTS channel_id` × 4 tables. Idempotente.
- ✅ **Backend routes** (12 fichiers) : events/polls/expenses/todos × 3
       (schemas.ts retire channelId du DTO + bodies + queries ; repo.ts
       retire des Inputs/inserts/updates/filters ; index.ts retire du
       toDto + create/patch/list).
- ✅ **Backend worker** : `event-reminders.test.ts` retire channelId du
       fixture makeEvent.
- ✅ **Frontend `lib/queries.ts`** : retire channelId des 4 schemas Zod
       (Event/Poll/Expense/TodoList) + des Inputs (Create*, Update*) +
       des filters de useEvents/usePolls/useExpenses/useTodoLists.
- ✅ **Frontend `screens/public/hooks.ts`** : retire channelId des 4
       schemas miroirs publics.
- ✅ **Frontend `AppShell.tsx`** : retire `LS_LAST_CHANNEL` constante,
       `channelId` du type LastLocation, lecture/écriture localStorage,
       state `activeChannelId`, dépendance useEffect.

### Lot D — Quick wins (drop encryption.ts orphan + env cleanup)

- ✅ **Drop module `integrations/core/encryption.ts` + son test** : depuis
       migration 0011, `encryptJson` / `decryptJson` ne sont plus appelés
       nulle part. À `git rm` côté Windows (le sandbox ne permet pas rm).
- ✅ **`core/env.ts` cleanup** : retire `ENCRYPTION_KEY_BRIDGES` (orphan
       depuis ADR-027) et `PROVIDER_SESSIONS_KEY` (orphan depuis 0011).
- ✅ **`.env.example` racine cleanup** : retire les vars d'env obsolètes
       (ENCRYPTION_KEY_BRIDGES, PROVIDER_SESSIONS_KEY, DISCORD_BOT_TOKEN/
       CLIENT_ID/CLIENT_SECRET/BOT_PERMISSIONS/PUBLIC_BASE_URL,
       MATRIX_HOMESERVER_URL/AS_TOKEN/HS_TOKEN — toutes mortes depuis
       ADR-027 + ADR-022).
- ✅ **`integrations/README.md` réécrit** : reflète l'archi post-ADR-027
       (plus de bridges server-side, juste CRUD sessions provider).
- ✅ **Backlog** : items "rotation PROVIDER_SESSIONS_KEY" et "astreinte
       bridges Messenger/WhatsApp" archivés (obsolètes).

## 📋 Fichiers modifiés cette session

```
.agent/backlog.md                                   # cleanup curé + 2 dettes archivées
.agent/current-task.md                              # ce fichier
.agent/notes/e2e-providers-2026-05-05.md            # nouveau (checklist E2E + résultats)
.env.example                                        # cleanup vars obsolètes (Discord, Matrix, encryption)
packages/backend/drizzle/migrations/0010_drop_messaging_channels.sql            # nouveau (+ fix IF EXISTS)
packages/backend/drizzle/migrations/0011_drop_encrypted_credentials.sql         # nouveau
packages/backend/drizzle/migrations/meta/0010_snapshot.json                     # nouveau
packages/backend/drizzle/migrations/meta/0011_snapshot.json                     # nouveau
packages/backend/drizzle/migrations/meta/_journal.json                          # +2 entries
packages/backend/src/core/env.ts                    # drop ENCRYPTION_KEY_BRIDGES + PROVIDER_SESSIONS_KEY
packages/backend/src/db/schema/index.ts             # drop messagingChannels/Messages/channelType/bytea/encryptedCredentials
packages/backend/src/integrations/README.md         # réécrit pour archi post-ADR-027
packages/backend/src/integrations/core/encryption.ts                            # 🗑️ à git rm (orphan migration 0011)
packages/backend/src/integrations/core/encryption.test.ts                       # 🗑️ à git rm
packages/backend/src/integrations/core/session-store.ts                         # cleanup get/setCredentials/hasCredentials
packages/backend/src/routes/messaging/schemas.ts    # retire hasCredentials du DTO
packages/backend/src/routes/notifications/schemas.ts                            # +2 schémas par-kind
packages/backend/src/workers/event-reminders.test.ts                            # +4 tests
packages/web/src/lib/queries.ts                     # retire hasCredentials du DTO front
packages/web/src/screens/app/AppShell.tsx          # nx:sessionOrder user-global + migration legacy
```

## 🔁 Suite logique

1. **🟢 ADR-029 (optionnel)** pour acter formellement les 2 kinds bonus
   (`event_rsvp_received`, `todo_completed`) qui dépassent le scope
   ADR-023. Pas urgent.
2. **🟠 Déploiement V1 sur VPS Hostinger** (cf. ADR-011 + ADR-012) — tout
   est techniquement prêt côté code, reste à pousser et configurer Caddy
   + systemd unit + reverse proxy + GHCR pipeline + certs Let's Encrypt.
   Session dédiée 2-3h.

## 🧹 Dette technique restante (résumé)

- 🟢 8 providers webview non testés faute de comptes (Telegram, Instagram,
  Slack, LinkedIn, X, Reddit, TikTok, Snapchat).
- 🟢 Pas de tests d'intégration HTTP sur les routes mutations
  events/expenses/todos (fan-out de notifs couvert à l'unité côté worker
  seulement).

## Blockers

Aucun. Reste à commit + push côté Windows et valider visuellement le flow
runtime.
