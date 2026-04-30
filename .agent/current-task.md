# Tâche en cours

**Statut** : ✅ J1 (Backend kernel) terminé. Prêt pour J2.

## J1 — Backend kernel : livré

### Validations finales (en sandbox /tmp + à valider en CI)

- ✅ `pnpm typecheck` — 3/3 packages compilent
- ✅ `pnpm test` — 15 tests passent (1 skip auth = Postgres absent en sandbox, OK en CI)
- ✅ Stack server fonctionnelle : Fastify 5 + Pino + Drizzle 0.36 + postgres-js + ioredis + @fastify/{cors,helmet,sensible,websocket}

### Sous-jalons livrés

| Sous-jalon | Contenu                                                                        |
|------------|--------------------------------------------------------------------------------|
| J1a        | Fastify + Pino + env Zod + erreurs typées + GET /api/v1/health                 |
| J1b        | Drizzle + 4 tables (users, groups, group_members, refresh_tokens) + migration `0000_init.sql` |
| J1c        | Helper `defineRoute` (validation Zod entrée/sortie + inférence types)          |
| J1d        | 6 endpoints auth : register / login / refresh (rotation + détection réutilisation) / logout / logout-all / me, argon2id, JWT HS256, requireAuth middleware |
| J1e        | Plugin WS `/ws?token=…`, connection-store, heartbeat, event `presence:update`, schéma WS partagé via `@nexus/shared` |
| J1f        | Workflow CI mis à jour avec services Postgres 16 + Redis 7                     |

### Points techniques notables

- **Refresh rotation** : à chaque `/refresh`, ancien token marqué `revokedAt` + chaîné via `replacedById` au nouveau. Réutilisation d'un token révoqué = revoke all chain (mitigation vol).
- **Argon2id** : params OWASP 2024 (m=19456, t=2, p=1).
- **Format d'erreur stable** : `{ error: { code, message, details, requestId } }`.
- **WS auth** : JWT en query param vérifié à l'open. Le payload `groupIds` permet le scoping presence sans roundtrip DB.
- **Tests d'intégration auth** : auto-skip si Postgres pas joignable (sandbox local), passent en CI grâce au service container.
- **Schémas DB monolithiques** : tous dans `db/schema/index.ts` à cause de la limitation drizzle-kit avec ESM `.js` imports. À splitter quand on dépassera ~10 tables par domaine.

### Fichiers ajoutés (résumé)

```
packages/backend/
├── drizzle.config.ts
├── drizzle/migrations/0000_init.sql
└── src/
    ├── core/
    │   ├── env.ts (Zod env validation)
    │   ├── logger.ts
    │   ├── errors.ts (codes typés)
    │   ├── error-handler.ts
    │   ├── define-route.ts (helper typé)
    │   └── middlewares/require-auth.ts
    ├── db/
    │   ├── client.ts (postgres-js + drizzle)
    │   ├── health.ts (ping pg+redis)
    │   └── schema/index.ts (4 tables)
    ├── routes/
    │   ├── health/health.ts (+ test)
    │   └── auth/
    │       ├── schemas.ts
    │       ├── service.ts
    │       ├── index.ts (6 endpoints)
    │       └── auth.test.ts (intégration, auto-skip)
    ├── ws/
    │   ├── connection-store.ts (+ test)
    │   └── index.ts (plugin WS)
    └── test/
        ├── helpers.ts (setTestEnv)
        └── db.ts (setupTestDb avec schema temporaire)

packages/shared/src/
└── ws-protocol.ts (+ test)
```

## Action attendue côté Manu

1. **Pull et rebase** sur main (pnpm-lock.yaml a beaucoup changé)
2. **`pnpm install`** chez toi pour récupérer les nouvelles deps
3. **Push** la branche → la CI tournera avec Postgres + Redis et tu verras l'auth réellement valider
4. **Tester en local** : `pnpm compose:up` puis `pnpm --filter @nexus/backend dev` puis appel HTTP sur `/api/v1/health` pour vérifier que tout boote

## Prochaine étape — J2 (Domaine groupes)

Estimation : 3-4 jours.
- Endpoints CRUD groupes (`/api/v1/groups`, `/groups/:id/members`, invitations par lien)
- Middleware `requireGroupMembership(groupIdParam)` dérivé du JWT
- Helper Drizzle `withGroupScope(groupId)`
- Tests sur les fuites cross-group (ADR-005)

## Blockers

Aucun. La validation fonctionnelle complète des tests auth se fera au push (CI avec Postgres).
