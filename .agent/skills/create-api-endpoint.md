# Skill — Créer un endpoint API Fastify

**Quand utiliser ce skill** : à chaque fois qu'on ajoute un endpoint REST sur le backend.

## Conventions Nexus

- Routes versionnées sous `/api/v1`.
- Schémas Zod en source de vérité, partagés via `@nexus/shared` quand exposés au client.
- Helper `defineRoute` (à implémenter en J1) pour inférer les types entrée/sortie.
- Erreurs typées avec un code (`AUTH_INVALID_CREDENTIALS`, `RESOURCE_NOT_FOUND`, etc.)
  et un mapping HTTP centralisé.

## Procédure

1. **Définir le schéma Zod** dans `@nexus/shared/src/schemas/<domain>.ts`
   (uniquement si exposé au client — sinon, garder dans `packages/backend/src/routes/<domain>/schemas.ts`)
2. **Créer la route** dans `packages/backend/src/routes/<domain>/<action>.ts`
3. **Brancher dans le plugin Fastify** du domaine (`packages/backend/src/routes/<domain>/index.ts`)
4. **Ajouter les middlewares d'autorisation** :
   - `requireAuth` pour authentifié
   - `requireGroupMembership(groupIdParam)` pour groupé
5. **Tests d'intégration** dans `packages/backend/src/routes/<domain>/__tests__/<action>.test.ts`
   - Cas nominal
   - Cas non authentifié → 401
   - Cas non autorisé → 403 (notamment cross-group, cf. ADR-005)
   - Cas validation invalide → 400 avec code `VALIDATION_ERROR`

## Pattern type (à adapter une fois `defineRoute` implémenté en J1)

```ts
// packages/backend/src/routes/events/create.ts
import { z } from 'zod';
import { defineRoute } from '../../core/define-route';
import { requireAuth, requireGroupMembership } from '../../core/middlewares';
import { eventService } from './service';

const Body = z.object({
  groupId: z.string().uuid(),
  title: z.string().min(1).max(120),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  description: z.string().max(2000).optional(),
});

const Reply = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  // ... champs de l'event
});

export const createEvent = defineRoute({
  method: 'POST',
  url: '/api/v1/groups/:groupId/events',
  body: Body,
  reply: Reply,
  preHandlers: [requireAuth, requireGroupMembership('groupId')],
  handler: async (req) => {
    const event = await eventService.create({
      ...req.body,
      createdBy: req.user.id,
    });
    return event;
  },
});
```

## Checklist avant merge

- [ ] Schéma Zod testé (cas valide + invalide)
- [ ] Au moins 3 tests d'intégration (nominal, 401, 403)
- [ ] Logs structurés ajoutés (pino, niveau `info` pour succès, `warn` pour 4xx, `error` pour 5xx)
- [ ] Si l'endpoint déclenche un événement WS, l'événement est typé dans `@nexus/shared`
- [ ] Pas de fuite cross-group (tester explicitement)
- [ ] Documentation mise à jour si l'endpoint est public ou utilisateur (`/api/v1` → typage descend automatiquement dans `@nexus/shared`)

## Anti-patterns à éviter

- ❌ Renvoyer une réponse non typée (`reply.send({...})` sans schéma)
- ❌ Faire des requêtes Drizzle sans filtre `groupId` (hors endpoints user-scoped)
- ❌ Throw `new Error('msg')` brut → utiliser les erreurs typées (`new AuthError('INVALID_CREDENTIALS')`)
- ❌ Logique métier dans le handler → toujours via un service `<domain>/service.ts`
