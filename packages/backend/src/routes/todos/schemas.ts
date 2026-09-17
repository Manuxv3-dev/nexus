/**
 * Schemas Zod Todos — DTOs renvoyés au client + bodies acceptés.
 *
 * Les DTO de réponse (`TodoItemDtoSchema`, `TodoListDtoSchema`) vivent dans
 * `@nexus/shared` (cf. ticket 0e8b5905) et sont ré-exportés ici pour ne pas
 * casser les imports internes du package `routes/todos/`. Le web les
 * importe directement depuis `@nexus/shared`.
 */
import { TodoItemDtoSchema, TodoListDtoSchema } from '@nexus/shared';
import { z } from 'zod';

export { TodoItemDtoSchema, TodoListDtoSchema };
export type { TodoItemDto, TodoListDto } from '@nexus/shared';

// ─────────────────────────── DTOs (replies) ─────────────────────────────

export const TodoListListReplySchema = z.object({ todoLists: z.array(TodoListDtoSchema) });
export const TodoListReplySchema = z.object({ todoList: TodoListDtoSchema });
export const TodoItemReplySchema = z.object({ todoItem: TodoItemDtoSchema });
export const DeleteReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Bodies ─────────────────────────────────────

export const CreateTodoListBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  title: z.string().min(1).max(120).trim(),
  initialItems: z
    .array(
      z.object({
        text: z.string().min(1).max(280).trim(),
        assigneeId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const UpdateTodoListBodySchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  title: z.string().min(1).max(120).trim().optional(),
});

export const AddTodoItemBodySchema = z.object({
  text: z.string().min(1).max(280).trim(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export const UpdateTodoItemBodySchema = z.object({
  text: z.string().min(1).max(280).trim().optional(),
  done: z.boolean().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});

// ─────────────────────────── Params ────────────────────────────────────

export const GroupIdParamsSchema = z.object({ groupId: z.string().uuid() });
export const ListIdParamsSchema = z.object({ listId: z.string().uuid() });
export const ItemIdParamsSchema = z.object({ itemId: z.string().uuid() });
export const SlugParamsSchema = z.object({ slug: z.string().min(4).max(64) });

export const ListTodoListsQuerySchema = z.object({});
