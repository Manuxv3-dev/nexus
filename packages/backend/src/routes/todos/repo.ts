/**
 * Repository Todos — accès Drizzle aux tables `todo_lists` et `todo_items`.
 *
 * Conventions :
 *  - Une "todo list" est un conteneur (titre, tags, channel optionnel).
 *  - Les items appartiennent à une liste, ont un `position` (int) pour
 *    l'ordre stable, un `done` boolean, un `assigneeId` optionnel.
 *  - Touch `todoLists.updated_at` à chaque mutation d'item ou de meta liste
 *    pour invalider le cache OG image.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { generateSlug } from '../../core/slug-generator.js';
import { getDb } from '../../db/client.js';
import {
  todoItems,
  todoLists,
  type NewTodoItem,
  type NewTodoList,
  type TodoItem,
  type TodoList,
} from '../../db/schema/index.js';

// ─────────────────────────── Types ──────────────────────────────────────

export interface TodoListWithItems extends TodoList {
  items: TodoItem[];
}

export interface CreateTodoListInput {
  groupId: string;
  tags?: string[];
  title: string;
  /**
   * Items optionnels créés en même temps (pratique pour la modal).
   * Le type accepte `undefined` explicite pour matcher l'inférence Zod
   * `nullable().optional()` côté schemas (`exactOptionalPropertyTypes`).
   */
  initialItems?: { text: string; assigneeId?: string | null | undefined }[];
  createdBy: string;
}

export interface UpdateTodoListInput {
  tags?: string[];
  title?: string;
}

export interface AddTodoItemInput {
  text: string;
  assigneeId?: string | null;
}

export interface UpdateTodoItemInput {
  text?: string;
  done?: boolean;
  assigneeId?: string | null;
  /** Repositionnement absolu (drag-drop). */
  position?: number;
}

// ─────────────────────────── Helpers ─────────────────────────────────────

async function touchList(listId: string): Promise<void> {
  const db = getDb();
  await db
    .update(todoLists)
    .set({ updatedAt: new Date() })
    .where(eq(todoLists.id, listId));
}

// ─────────────────────────── Lists ───────────────────────────────────────

export async function createTodoList(
  input: CreateTodoListInput,
): Promise<TodoListWithItems> {
  const db = getDb();
  const slug = generateSlug();
  const insert: NewTodoList = {
    slug,
    groupId: input.groupId,
    tags: input.tags ?? [],
    title: input.title,
    createdBy: input.createdBy,
  };
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.insert(todoLists).values(insert).returning();
    if (!row) throw new Error('insert todo_list failed');
    if (input.initialItems && input.initialItems.length > 0) {
      const itemInserts: NewTodoItem[] = input.initialItems.map((item, i) => ({
        listId: row.id,
        text: item.text,
        done: false,
        assigneeId: item.assigneeId ?? null,
        position: i,
      }));
      await tx.insert(todoItems).values(itemInserts);
    }
    return row;
  });
  const full = await getTodoListById(result.id);
  if (!full) throw new Error('todo_list vanished after insert');
  return full;
}

export async function updateTodoList(
  id: string,
  patch: UpdateTodoListInput,
): Promise<TodoList | undefined> {
  const db = getDb();
  const set: Partial<NewTodoList> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.title !== undefined) set.title = patch.title;
  const [row] = await db.update(todoLists).set(set).where(eq(todoLists.id, id)).returning();
  return row;
}

export async function deleteTodoList(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(todoLists)
    .where(eq(todoLists.id, id))
    .returning({ id: todoLists.id });
  return result.length > 0;
}

export async function getTodoListById(id: string): Promise<TodoListWithItems | null> {
  const db = getDb();
  const [row] = await db.select().from(todoLists).where(eq(todoLists.id, id)).limit(1);
  if (!row) return null;
  return hydrate(row);
}

export async function getTodoListBySlug(slug: string): Promise<TodoListWithItems | null> {
  const db = getDb();
  const [row] = await db.select().from(todoLists).where(eq(todoLists.slug, slug)).limit(1);
  if (!row) return null;
  return hydrate(row);
}

async function hydrate(row: TodoList): Promise<TodoListWithItems> {
  const db = getDb();
  const items = await db
    .select()
    .from(todoItems)
    .where(eq(todoItems.listId, row.id))
    .orderBy(asc(todoItems.position));
  return { ...row, items };
}

export async function listTodoListsByGroup(
  groupId: string,
): Promise<TodoListWithItems[]> {
  const db = getDb();
  const conditions = [eq(todoLists.groupId, groupId)];
  const rows = await db
    .select()
    .from(todoLists)
    .where(and(...conditions))
    .orderBy(asc(todoLists.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const allItems = await db
    .select()
    .from(todoItems)
    .where(inArray(todoItems.listId, ids))
    .orderBy(asc(todoItems.position));
  const byList = new Map<string, TodoItem[]>();
  for (const it of allItems) {
    const list = byList.get(it.listId) ?? [];
    list.push(it);
    byList.set(it.listId, list);
  }
  return rows.map((r) => ({ ...r, items: byList.get(r.id) ?? [] }));
}

// ─────────────────────────── Items ───────────────────────────────────────

export async function addTodoItem(
  listId: string,
  input: AddTodoItemInput,
): Promise<TodoItem> {
  const db = getDb();
  // Détermine la prochaine position : max(position) + 1.
  const existing = await db
    .select({ position: todoItems.position })
    .from(todoItems)
    .where(eq(todoItems.listId, listId))
    .orderBy(asc(todoItems.position));
  const nextPos = existing.length === 0 ? 0 : Math.max(...existing.map((x) => x.position)) + 1;
  const [row] = await db
    .insert(todoItems)
    .values({
      listId,
      text: input.text,
      done: false,
      assigneeId: input.assigneeId ?? null,
      position: nextPos,
    })
    .returning();
  if (!row) throw new Error('insert todo_item failed');
  await touchList(listId);
  return row;
}

export async function updateTodoItem(
  itemId: string,
  patch: UpdateTodoItemInput,
): Promise<TodoItem> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(todoItems)
    .where(eq(todoItems.id, itemId))
    .limit(1);
  if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
  const set: Partial<NewTodoItem> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.done !== undefined) set.done = patch.done;
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  if (patch.position !== undefined) set.position = patch.position;
  const [row] = await db
    .update(todoItems)
    .set(set)
    .where(eq(todoItems.id, itemId))
    .returning();
  if (!row) throw new Error('update todo_item failed');
  await touchList(row.listId);
  return row;
}

export async function deleteTodoItem(itemId: string): Promise<TodoItem | null> {
  const db = getDb();
  const [row] = await db
    .delete(todoItems)
    .where(eq(todoItems.id, itemId))
    .returning();
  if (row) await touchList(row.listId);
  return row ?? null;
}

export async function getTodoItem(itemId: string): Promise<TodoItem | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(todoItems)
    .where(eq(todoItems.id, itemId))
    .limit(1);
  return row ?? null;
}
