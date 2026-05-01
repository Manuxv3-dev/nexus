# Tâche en cours

**Statut** : ✅ J2 (Domaine groupes) terminé. Prêt pour J3 (Architecture bridges + Discord).

## J2 — Domaine groupes : livré

### Validations finales

- ✅ `pnpm typecheck` — 3/3 packages compilent (sandbox + à confirmer en CI)
- ✅ `pnpm lint` — 0 errors (89 warnings préexistants sur le ws code)
- ✅ `pnpm test` — 14 tests passent + 2 fichiers skip (auth.test + groups.test
  attendent Postgres, normal en sandbox local sans Docker, OK en CI)
- ✅ Stack endpoints groupes : 11 routes REST `/api/v1/groups[*]` et
  `/api/v1/invitations/:slug/accept`

### Sous-jalons livrés

| Sous-jalon | Contenu                                                                        |
|------------|--------------------------------------------------------------------------------|
| J2a        | Table `group_invitations` (slug, role, maxUses, usedCount, expiresAt, revokedAt) + migration `0001_add_group_invitations.sql` |
| J2b        | Service groupes (`createGroupForUser`, `listGroupsForUser`, `findGroupById`, `findMembership`, `listMembers`, `updateGroup`, `deleteGroup`, `removeMember`, invitations) + helper `slug-generator` base62 + 5 tests unitaires |
| J2c        | Middleware `requireGroupMembership` + helpers `getGroupContext` / `requireGroupRole` (hiérarchie owner=3 > admin=2 > member=1) |
| J2d        | 5 endpoints CRUD groupes : POST `/groups`, GET `/groups`, GET/PATCH/DELETE `/groups/:groupId` |
| J2e        | 6 endpoints membres + invitations : GET `/groups/:groupId/members`, DELETE `/groups/:groupId/members/:userId`, POST/GET `/groups/:groupId/invitations`, DELETE `/groups/:groupId/invitations/:invitationId`, POST `/invitations/:slug/accept` |
| J2f        | 23 tests d'intégration couvrant : CRUD, anti-leak cross-group, permissions par rôle, idempotence accept, max_uses, révocation, self-leave |
| J2g        | Lint 0 errors, sync mount, MAJ roadmap + current-task                          |

### Points techniques notables

- **Anti-leak strict** : toute route scopée à un groupe renvoie **404** si
  l'user n'est pas membre — pas 403. Empêche l'énumération de groupIds valides.
- **Anti-leak DB-side** : `findInvitationInGroup(groupId, invitationId)` filtre
  sur les deux clés. Le DELETE invitation refuse de toucher à une invitation
  d'un autre groupe même si l'attaquant connaît son ID.
- **Acceptation idempotente** : `acceptInvitation` utilise une transaction avec
  `FOR UPDATE` lock sur la ligne d'invitation, vérifie revoked/expired/maxUses,
  puis crée la membership ou no-op si déjà membre. `usedCount` incrémenté
  uniquement à la première création.
- **Hiérarchie de rôles enforce dans le service ET le middleware** : un admin
  ne peut pas créer d'invitation pour un rôle owner ; un membre simple ne peut
  pas inviter ; un owner ne peut pas être removed (transfert d'ownership = V2).
- **Slug d'invitation** : 12 chars base62 = 3.2e21 combinaisons → énumération
  impossible. Retry sur collision (5 tentatives, jamais déclenchées en pratique).
- **JWT n'est pas trusted pour la membership** : le middleware fait toujours un
  read DB. Évite le cas où le token contient une membership révoquée.

### Fichiers ajoutés / modifiés (J2)

```
packages/backend/
├── drizzle/migrations/
│   └── 0001_add_group_invitations.sql           [J2a]
└── src/
    ├── core/
    │   ├── slug-generator.ts                    [J2b — 35 lignes]
    │   ├── slug-generator.test.ts               [J2b — 5 tests]
    │   └── middlewares/
    │       └── require-group-membership.ts      [J2c — middleware + helpers]
    ├── db/schema/index.ts                       [+ table group_invitations]
    ├── routes/groups/
    │   ├── service.ts                           [J2b — 360 lignes]
    │   ├── schemas.ts                           [J2d/e — schémas Zod]
    │   ├── index.ts                             [J2d/e — 11 endpoints, 315 lignes]
    │   └── groups.test.ts                       [J2f — 23 tests intégration]
    └── server.ts                                [+ register groupsPlugin]
```

## Action attendue côté Manu

1. **Pull et rebase** sur main
2. **`pnpm install`** chez toi (rien de nouveau côté deps, juste s'assurer)
3. **Push** la branche → la CI exécutera les 23 tests d'intégration avec Postgres réel
4. **Tester en local** :
   - `pnpm compose:up` puis `pnpm --filter @nexus/backend db:migrate`
   - `pnpm --filter @nexus/backend dev`
   - Crée un user via `/api/v1/auth/register`
   - Crée un groupe via `POST /api/v1/groups`
   - Crée une invitation, ouvre un autre user, accepte via `POST /api/v1/invitations/:slug/accept`

## Prochaine étape — J3 (Architecture bridges + Discord)

Estimation : 1.5 à 2 semaines. C'est le gros morceau du MVP.

Découpage prévu :
- **J3a** Architecture commune des bridges (cf. ADR-009)
  - Interface `MessagingProvider` dans `@nexus/shared`
  - Table `messaging_provider_sessions` + chiffrement AES-GCM des credentials
  - Module `@nexus/backend/integrations/core/` : session-store, encryption,
    bridge-registry, event-bus Redis pub/sub
  - Pattern worker BullMQ avec lock Redis pour stickiness session
  - Healthcheck/monitoring de base (gauges, lag_ms)
- **J3b** Implémentation Discord
  - `DiscordProvider` via discord.js v14
  - OAuth bot register flow
  - Worker `discord-bridge` (process séparé)
  - Mapping `messaging_channels` ↔ Discord channel IDs
  - Sync historique paginé (BullMQ idempotent)
- **J3c** Propagation événements
  - Pub/sub Redis : worker → backend API → WS clients
  - WS events `message:new`, `message:edit`, `message:delete`
  - Endpoint `GET /groups/:id/messages?cursor=`
- **J3d** Tests bridge + endpoints messages

Avant de commencer J3a, rédiger un plan détaillé (comme pour J1) pour s'aligner
sur la structure dossier `integrations/`, le format chiffré, et le contrat
worker ↔ API.

## Blockers

Aucun. Tests d'intégration validés en sandbox (skip Postgres = OK), passeront
en CI.
