# Tâche en cours

**Statut** : ✅ Session 2026-05-05 — V1.2 notifications transverses producteurs
durci (ajouts mineurs : 2 schémas par-kind + 4 tests worker). À commit + push.

**Statut session 2026-05-04** : ✅ Polish post-ADR-027 (P1→P8) +
révision M (ADR-028 sessions user-scoped) + GroupHome densifié +
branding "Nexus" → "nexus" + V1.2 notifs producteurs déjà branchés
dans les routes mutations (events / expenses / todos) et le worker
`event-reminders`. À commit + push.

## 🎯 Action immédiate côté Manu

```powershell
cd C:\Users\Manu\claude\nexus\nexus

# 1. Migrations (M1 destructive : drop sessions existantes !)
pnpm --filter @nexus/backend db:migrate

# 2. Vérifs
pnpm --filter @nexus/backend test          # 46 passed | 3 skipped (Postgres absent)
pnpm --filter @nexus/backend typecheck     # clean
pnpm --filter @nexus/web build
pnpm install                               # purge le lockfile au cas où

# 3. Test runtime Tauri (3-4 min) :
#    - Sessions DB vidées par 0009 — re-connecter un provider depuis Settings
#    - Vérifier sidebar : sessions globales user, plus de dot provider sur pills groupe
#    - Vérifier GroupHome : 4 Hero cards (events / polls / expenses / todos),
#      plus de section conversations
#    - Vérifier drag&drop reorder sessions sidebar (P4)
#    - Vérifier que les contrôles min/max/close sont visibles top-right (P2)
#    - Vérifier qu'une notif tombe en DB quand un autre user crée un event /
#      ajoute une dépense / m'assigne un todo (cf. cloche sidebar)
```

## 📦 Livré ce passage (session 2026-05-05)

### V1.2 notifications transverses — durcissement

Constat de session : les producteurs étaient en réalité **déjà branchés**
en code (le récap session précédente était pessimiste). Action restante :
combler les manques de cohérence et ajouter la couverture de tests.

- ✅ **Schémas Zod par kind manquants** : ajouté `EventRsvpReceivedPayloadSchema`
       et `TodoCompletedPayloadSchema` dans
       `packages/backend/src/routes/notifications/schemas.ts` pour aligner les
       6 kinds présents dans `NotificationKindSchema` (shared) et utilisés
       dans les routes.
- ✅ **Tests worker `event-reminders`** : ajout de 4 tests qui couvrent le
       branchement DB (insertNotificationsBulk fan-out, publish
       `notification:created` per recipient, comportement best-effort si DB
       échoue). 9/9 tests passent. Backend total : 46 passed / 3 skipped /
       0 failed. Typecheck clean.

### État branchements V1.2 (récap)

| Kind | Producteur | Audience |
|---|---|---|
| `event_reminder` | Worker `event-reminders` (T-24h / T-1h) | Members sauf RSVP=no |
| `event_rsvp_requested` | POST `/api/v1/groups/:groupId/events` | Members sauf créateur |
| `event_rsvp_received` *(bonus hors scope ADR-023)* | POST `/api/v1/events/:id/rsvp` | Créateur de l'event (sauf si self-RSVP) |
| `expense_added` | POST `/api/v1/groups/:groupId/expenses` | Co-payeurs avec shareCents>0 sauf payeur |
| `todo_assigned` | POST `/api/v1/todo-lists/:id/items` + PATCH `/api/v1/todo-items/:id` | Nouvel assigné (sauf self) |
| `todo_completed` *(bonus hors scope ADR-023)* | PATCH `/api/v1/todo-items/:id` (done false→true) | Créateur de la liste (sauf self) |

## 🔁 Suite logique

Trois directions possibles, par ordre de priorité :

1. **🟠 Test E2E manuel des 12 providers Tauri** (action #2 prévue) : ouvrir
   / fermer / re-ouvrir chaque webview, vérifier persistence cookies,
   surtout les 9 nouveaux (Telegram, TikTok, Snapchat, etc.). Flagger les
   providers qui demandent un fix particulier.

2. **🟢 Cleanup dette technique légère** (action #3 prévue) :
   - Migration 0010 : drop `messaging_channels` (orphan depuis ADR-027)
   - Migration 0011 : drop `messaging_provider_sessions.encrypted_credentials`
   - Unifier clé localStorage `nx:sessionOrder:${groupId}` → `nx:sessionOrder`
     (cf. ADR-028 conséquences neutres)
   - Nettoyer backlog des items chat-programmable obsolètes (composer,
     scroll auto, attachments, réactions, mentions, dates relatives)

3. **🟢 ADR-029 (optionnel)** pour acter formellement les 2 kinds bonus
   (`event_rsvp_received`, `todo_completed`) qui dépassent le scope
   ADR-023. Pas urgent — c'est documenté ici et dans les commentaires
   de `notifications/schemas.ts`.

## 🧹 Dette technique introduite/restante

- 🟢 Migration 0010 future pour drop `messaging_channels` table
  (orphan depuis ADR-027 + vidée par 0009 cascade)
- 🟢 Migration 0011 future pour drop
  `messaging_provider_sessions.encrypted_credentials` column
  (jamais utilisée depuis ADR-027 — toutes sessions sont webview-encapsulées
  sans creds serveur)
- 🟢 Clé localStorage `nx:sessionOrder:${groupId}` toujours scope groupId,
  alors que les sessions sont user-scoped. Effet : l'ordre user diffère
  selon le groupe sélectionné. À unifier en `nx:sessionOrder` simple
  (cf. ADR-028 conséquences neutres).
- 🟢 Nettoyage backlog : retirer les items chat-programmable obsolètes
  depuis ADR-027 (composer, scroll auto, attachments, réactions, etc.)
- 🟢 Pas de tests d'intégration HTTP sur les routes mutations
  events / expenses / todos (le fan-out de notifs n'est pas couvert
  bout-en-bout, juste à l'unité côté worker). À ajouter quand on
  durcira la suite de tests J5+.

## Blockers

Aucun. Reste à valider visuellement le flow runtime côté Manu et push.
