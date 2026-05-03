# Tâche en cours

**Statut** : ⚠️ Session 2026-05-03 — #42 codé bout-en-bout côté agent,
**vérification + commits restent à faire côté Manu** (le sandbox de dev a
des problèmes de permissions cross-mount qui empêchent `pnpm install`,
`pnpm typecheck`, `pnpm lint`, `pnpm test` et `git commit`).

## 🎯 Action immédiate côté Manu (PowerShell)

```powershell
cd C:\Users\Manu\claude\nexus\nexus

# 1) Sync deps (bullmq ajoutée)
pnpm install

# 2) Supprimer le shim deprecated qu'on n'a pas pu rm dans le sandbox
git rm packages/backend/src/services/event-reminders.ts
Remove-Item packages/backend/src/services -Recurse -Force

# 3) Verifs
pnpm typecheck
pnpm lint
pnpm --filter @nexus/backend test

# 4) Si tout vert, commits decoupes (Conventional Commits) :

git add packages/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): add bullmq dep + reminders worker scripts"

git add packages/shared/src/ws-protocol.ts
git commit -m "feat(shared): add event:reminder WS event + EventReminderTier"

git add packages/backend/src/workers/queues.ts
git commit -m "feat(backend): BullMQ queue infra (queues.ts factory)"

git add packages/backend/src/routes/events/scheduler.ts \
        packages/backend/src/routes/events/scheduler.test.ts \
        packages/backend/src/routes/events/index.ts
git commit -m "feat(backend): event reminders scheduler + hooks dans routes events (ADR-020)"

git add packages/backend/src/workers/event-reminders.ts \
        packages/backend/src/workers/event-reminders.test.ts
git commit -m "feat(backend): worker BullMQ event-reminders (T-24h + T-1h, RSVP=no exclus)"

git add packages/web/src/lib/useEventReminderToast.ts \
        packages/web/src/screens/app/AppShell.tsx
git commit -m "feat(web): toast event:reminder dans AppShell + hook dedie"

git add .agent/adr/ADR-020-event-reminders-worker.md .agent/README.md \
        .agent/backlog.md .agent/current-task.md
git commit -m "docs(agent): ADR-020 worker reminders + pivot Messenger/WA backlog"

git push
```

## 📦 Livré ce passage (#42 — Worker BullMQ rappels Events)

### Spec actée (cf. ADR-020 pour détails)

| Décision | Choix |
|---|---|
| Paliers | `h24` (T-24h) + `h1` (T-1h) — 2 tiers fixes |
| Audience | members du group **sauf** RSVP=`no` (yes + maybe + non-répondants) |
| Canal V1 | WS only via `publishNexusEvent` → `nexus-relay` |
| Update event | jobId déterministe `event-reminder:{eventId}:{tier}` → `remove()` + `add()` |
| Idempotence runtime | worker re-load DB, skip si event introuvable ou `startsAt < now() - 5min` |
| Suppression event | DELETE handler → `cancelEventReminders(eventId)` |
| WS event | nouveau `event:reminder`, payload `{ eventId, tier, userIds }` |
| Job dans le passé | si `delay <= 0` à la création, on skip ce tier (pas de job rétroactif) |

### Fichiers créés/modifiés

```
packages/backend/
├── package.json                              [maj] +bullmq + dev/start scripts worker
├── src/workers/queues.ts                     [new] factory BullMQ singleton lazy
├── src/workers/event-reminders.ts            [new] worker process (lock + Worker + processor)
├── src/workers/event-reminders.test.ts       [new] tests processor (mocks DB/groups/WS)
├── src/routes/events/
│   ├── index.ts                              [maj] hooks schedule/reschedule/cancel dans POST/PATCH/DELETE
│   ├── scheduler.ts                          [new] schedule/cancel/reschedule + jobId helper
│   └── scheduler.test.ts                     [new] tests scheduler (mocks queue)
└── src/services/event-reminders.ts           [DEPRECATED — à git rm]

packages/shared/
└── src/ws-protocol.ts                        [maj] +EventReminderEventSchema + Tier + types

packages/web/
├── src/lib/useEventReminderToast.ts          [new] hook WS → state + auto-dismiss 8s
└── src/screens/app/AppShell.tsx              [maj] toast UI + bouton CTA bascule pane Events

.agent/
├── adr/ADR-020-event-reminders-worker.md     [new]
├── README.md                                 [maj] +ADR-019 (deja existant) + ADR-020
├── backlog.md                                [maj] pivot Messenger/WA → encapsulation web
└── current-task.md                           [maj] (ce fichier)
```

### Conséquences ops VPS Hostinger

Nouveau service à provisionner aux côtés des existants (cf. ADR-012,
à documenter dans la procédure J3.5 CI/CD) :
- `nexus-worker-reminders.service` → `pnpm start:worker:reminders`
- Pas de nouveau port (utilise Postgres + Redis déjà en place)
- Healthcheck simple via journalctl

## 🔁 Pivot architectural acté ce passage (à finaliser plus tard)

Manu a décidé le 2026-05-03 que **Messenger et WhatsApp seront encapsulés
en webview Tauri** (modèle Franz/Ferdium) plutôt qu'en bridges custom
(Baileys, mautrix-meta). Cf. mémoire + `.agent/backlog.md` pour les
détails. Conséquence :
- ADR de remplacement à rédiger (invalidera ADR-007 + ADR-008) → tâche #4
- Roadmap J7/J8 à réviser fortement à la baisse une fois l'ADR écrit
- Annule le besoin du POC Conduit + mautrix-meta

## ⚠️ Limitations sandbox dev rencontrées (à savoir)

Le sandbox cross-mount Windows/Linux a plusieurs comportements gênants :
- Refus de `pnpm install` (EPERM sur unlink des `_tmp_*` files)
- Refus de `git commit` (`.git/index.lock` non-supprimable)
- `Write` tool ne tronque pas les fichiers existants → si un nouveau
  contenu est plus court que l'original, NUL bytes en queue. Workaround :
  `truncate` via bash, ou append plutôt que rewrite.
- `Write` tool ne grandit pas les fichiers existants au-delà de leur
  taille originale → contenu coupé. Workaround : append via bash heredoc.

Conséquence : pendant la session j'ai pu écrire et lire les fichiers,
mais pas les valider via tsc/lint/tests. **Manu doit lancer la verif côté
PowerShell** avant de commit.

## Plan prochaine session

1. **Vérification des livrables #42** : si verif Manu remonte des erreurs,
   itérer.
2. **#44 Tests d'intégration mutations critiques** — RSVP, vote single/multi,
   expense create+settle, todo check+assign avec `node:test` + supertest.
3. **ADR de remplacement Messenger/WA = webview** (tâche #4) — invalider
   ADR-007 + ADR-008, réviser roadmap J7/J8.
4. **Bugs polish non bloquants** (à arbitrer J5c) :
   - **#53** bot Discord poste les messages au lieu du user
   - **#54** sens de défilement messages (récents en bas)
   - **#56** feedback visuel insuffisant boutons popups/cards
   - **#52** DS v2 Phase 2 (CVA + Phosphor migration)
   - **#49** partage cross-channel d'items

## Blockers

- 🟠 Verif côté Manu requise avant commit (cf. limitations sandbox).
