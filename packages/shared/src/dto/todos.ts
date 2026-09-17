import { z } from 'zod';

/**
 * DTO Todos partagé backend/web (cf. ticket 0e8b5905).
 *
 * Source de vérité unique pour la forme renvoyée par
 * `packages/backend/src/routes/todos/schemas.ts` (`TodoListDtoSchema`,
 * `TodoItemDtoSchema`) et consommée par `@nexus/web`
 * (`packages/web/src/lib/queries.ts`).
 *
 * Les schémas de **body** (create/update) et de **query/params** restent
 * dans `packages/backend/src/routes/todos/schemas.ts`.
 */

export const TodoItemDtoSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  done: z.boolean(),
  assigneeId: z.string().uuid().nullable(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoItemDto = z.infer<typeof TodoItemDtoSchema>;

export const TodoListDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  tags: z.array(z.string()),
  title: z.string(),
  items: z.array(TodoItemDtoSchema),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoListDto = z.infer<typeof TodoListDtoSchema>;
