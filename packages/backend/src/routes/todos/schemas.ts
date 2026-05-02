/**
 * Schemas Zod Todos — DTOs renvoyés au client + bodies acceptés.
 */
import { z } from 'zod';

// ─────────────────────────── DTOs (replies) ─────────────────────────────

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
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
  items: z.array(TodoItemDtoSchema),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoListDto = z.infer<typeof TodoListDtoSchema>;

export const TodoListListReplySchema = z.object({ todoLists: z.array(TodoListDtoSchema) });
export const TodoListReplySchema = z.object({ todoList: TodoListDtoSchema });
export const TodoItemReplySchema = z.object({ todoItem: TodoItemDtoSchema });
export const DeleteReplySchema = z.object({ ok: z.literal(true) });

// ─────────────────────────── Bodies ─────────────────────────────────────

export const CreateTodoListBodySchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
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
  channelId: z.string().uuid().nullable().optional(),
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

export const ListTodoListsQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
});
