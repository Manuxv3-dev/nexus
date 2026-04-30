# Skill — Ajouter un événement WebSocket

**Quand utiliser ce skill** : à chaque ajout d'un événement temps réel
(server → client ou client → server).

## Rappels (cf. ADR-003)

- Lib `ws` via `@fastify/websocket`, pas Socket.IO.
- Schéma typé dans `@nexus/shared/src/ws-protocol.ts`, validé par Zod.
- Pub/sub multi-instance via Redis (`ioredis`), channel `group:{groupId}` ou
  `user:{userId}` selon l'audience.
- Format d'événement : `{ type, payload, timestamp, groupId? }`.

## Procédure

1. **Définir le schéma de l'event** dans `@nexus/shared/src/ws-protocol.ts` :
   ajouter une variante au discriminated union `WsEvent`.
2. **Émettre côté backend** : utiliser le bus interne `wsBus.publish(...)`
   qui gère la sérialisation, la validation Zod et la diffusion Redis.
3. **Consommer côté desktop** : ajouter un handler dans le store Zustand
   `useWsStore` ou un selector ciblé.
4. **Tests** : ajouter un test d'intégration qui déclenche l'event côté
   backend et vérifie la réception côté un client WS connecté.

## Pattern type (post J1, sous réserve du nommage final des helpers)

### 1. Définir le schéma

```ts
// packages/shared/src/ws-protocol.ts (extrait)
export const ExpenseAddedEventSchema = z.object({
  type: z.literal('expense:added'),
  payload: ExpenseSchema,
  groupId: z.string().uuid(),
  timestamp: z.number().int(),
});

export const WsEventSchema = z.discriminatedUnion('type', [
  MessageNewEventSchema,
  // ...
  ExpenseAddedEventSchema,
]);

export type WsEvent = z.infer<typeof WsEventSchema>;
```

### 2. Émettre côté backend

```ts
// packages/backend/src/routes/expenses/create.ts (extrait)
const expense = await expenseService.create(...);

await wsBus.publish({
  type: 'expense:added',
  payload: expense,
  groupId: expense.groupId,
  timestamp: Date.now(),
});

return expense;
```

### 3. Consommer côté desktop

```ts
// packages/desktop/src/stores/ws-store.ts (extrait)
on('expense:added', (e) => {
  queryClient.invalidateQueries({ queryKey: ['expenses', e.groupId] });
  // ou mise à jour optimiste si on a déjà la donnée
});
```

## Audience (qui reçoit l'événement)

- **Group-scoped** (cas le plus fréquent) : `groupId` dans l'event, diffusé via
  channel Redis `group:{groupId}`. Tous les clients connectés à ce groupe
  reçoivent.
- **User-scoped** (notifs perso, présence cross-groupes) : pas de `groupId`,
  channel `user:{userId}`.
- **Broadcast global** : à éviter, usage uniquement pour annonces système
  (mode maintenance par exemple).

## Checklist avant merge

- [ ] Schéma Zod ajouté dans `@nexus/shared`
- [ ] Validation côté backend ET desktop (defensive parsing)
- [ ] Audience explicitée (group-scoped, user-scoped, ou justifié si broadcast)
- [ ] `groupId` présent dans le payload pour les events group-scoped (cf. ADR-005)
- [ ] Test d'intégration qui couvre la propagation
- [ ] Doc inline (TSDoc) sur le type ajouté

## Anti-patterns à éviter

- ❌ Émettre un event sans passer par `wsBus.publish` (court-circuite la validation
  et la diffusion Redis)
- ❌ Émettre un event group-scoped sans `groupId`
- ❌ Mettre des données sensibles non filtrées (passwords, tokens, autres groupes)
  dans le payload
- ❌ Traiter un message WS reçu côté client sans validation Zod (un event mal
  formé peut crash le store)
