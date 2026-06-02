/**
 * Routes Todos — CRUD list + items + lecture publique (cf. J5b #41).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/todo-lists
 *   GET    /api/v1/groups/:groupId/todo-lists
 *   GET    /api/v1/todo-lists/:listId
 *   PATCH  /api/v1/todo-lists/:listId
 *   DELETE /api/v1/todo-lists/:listId
 *
 *   POST   /api/v1/todo-lists/:listId/items
 *   PATCH  /api/v1/todo-items/:itemId         (text, done, assigneeId, position)
 *   DELETE /api/v1/todo-items/:itemId
 *
 *   GET    /api/v1/public/todos/:slug
 *
 * Permissions :
 *  - CRUD list : tout membre du groupe propriétaire.
 *  - DELETE list : createdBy ou owner/admin.
 *  - Mutations items : tout membre.
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
} from '../../core/middlewares/require-group-membership.js';
import { findMembership, listMembers } from '../groups/service.js';
import { insertNotification } from '../notifications/repo.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';
import { recordActivityWithLookup } from '../activity/repo.js';

import {
  addTodoItem,
  createTodoList,
  deleteTodoItem,
  deleteTodoList,
  getTodoItem,
  getTodoListById,
  getTodoListBySlug,
  listTodoListsByGroup,
  updateTodoItem,
  updateTodoList,
  type TodoListWithItems,
} from './repo.js';
import {
  AddTodoItemBodySchema,
  CreateTodoListBodySchema,
  DeleteReplySchema,
  GroupIdParamsSchema,
  ItemIdParamsSchema,
  ListIdParamsSchema,
  ListTodoListsQuerySchema,
  SlugParamsSchema,
  TodoItemReplySchema,
  TodoListListReplySchema,
  TodoListReplySchema,
  UpdateTodoItemBodySchema,
  UpdateTodoListBodySchema,
  type TodoItemDto,
  type TodoListDto,
} from './schemas.js';

import type { FastifyPluginAsync } from 'fastify';
import type { TodoItem } from '../../db/schema/index.js';

function listToDto(l: TodoListWithItems): TodoListDto {
  return {
    id: l.id,
    slug: l.slug,
    groupId: l.groupId,
    tags: l.tags,
    title: l.title,
    items: l.items.map(itemToDto),
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function itemToDto(i: TodoItem): TodoItemDto {
  return {
    id: i.id,
    listId: i.listId,
    text: i.text,
    done: i.done,
    assigneeId: i.assigneeId,
    position: i.position,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export const todosPlugin: FastifyPluginAsync = async (app) => {
  // POST /groups/:groupId/todo-lists
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/todo-lists',
      params: GroupIdParamsSchema,
      body: CreateTodoListBodySchema,
      reply: TodoListReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const userId = req.user!.id;
        // Spread conditionnel : sous `exactOptionalPropertyTypes`, passer
        // `initialItems: undefined` est interdit. On n'inclut le champ que
        // s'il a une valeur.
        const created = await createTodoList({
          groupId: ctx.groupId,
          tags: req.body.tags ?? [],
          title: req.body.title,
          ...(req.body.initialItems !== undefined && {
            initialItems: req.body.initialItems,
          }),
          createdBy: userId,
        });
        await publishNexusEvent({
          type: 'todo_list:created',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { listId: created.id },
        });
        // ADR-029 : log d'activité.
        await recordActivityWithLookup(
          {
            groupId: ctx.groupId,
            actorId: userId,
            kind: 'todo_list:created',
            targetId: created.id,
            targetType: 'todo_list',
            extraPayload: { targetTitle: created.title },
          },
          req.log,
        );
        return { todoList: listToDto(created) };
      },
    }),
  );

  // GET /groups/:groupId/todo-lists
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/todo-lists',
      params: GroupIdParamsSchema,
      query: ListTodoListsQuerySchema,
      reply: TodoListListReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const list = await listTodoListsByGroup(ctx.groupId);
        return { todoLists: list.map(listToDto) };
      },
    }),
  );

  // GET /todo-lists/:listId
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/todo-lists/:listId',
      params: ListIdParamsSchema,
      reply: TodoListReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const list = await getTodoListById(req.params.listId);
        if (!list) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(list.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        return { todoList: listToDto(list) };
      },
    }),
  );

  // PATCH /todo-lists/:listId
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/todo-lists/:listId',
      params: ListIdParamsSchema,
      body: UpdateTodoListBodySchema,
      reply: TodoListReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getTodoListById(req.params.listId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const patch: Parameters<typeof updateTodoList>[1] = {};
        if (req.body.tags !== undefined) patch.tags = req.body.tags;
        if (req.body.title !== undefined) patch.title = req.body.title;
        await updateTodoList(req.params.listId, patch);
        await publishNexusEvent({
          type: 'todo_list:updated',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { listId: existing.id },
        });
        const full = await getTodoListById(req.params.listId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { todoList: listToDto(full) };
      },
    }),
  );

  // DELETE /todo-lists/:listId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/todo-lists/:listId',
      params: ListIdParamsSchema,
      reply: DeleteReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getTodoListById(req.params.listId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.createdBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        await deleteTodoList(req.params.listId);
        await publishNexusEvent({
          type: 'todo_list:deleted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { listId: existing.id },
        });
        return { ok: true as const };
      },
    }),
  );

  // POST /todo-lists/:listId/items
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/todo-lists/:listId/items',
      params: ListIdParamsSchema,
      body: AddTodoItemBodySchema,
      reply: TodoItemReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const list = await getTodoListById(req.params.listId);
        if (!list) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(list.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const item = await addTodoItem(req.params.listId, {
          text: req.body.text,
          assigneeId: req.body.assigneeId ?? null,
        });
        await publishNexusEvent({
          type: 'todo_item:added',
          groupId: list.groupId,
          timestamp: Date.now(),
          payload: { listId: list.id, itemId: item.id },
        });
        // Si l'item est créé déjà assigné à quelqu'un (≠ self), on notifie.
        if (item.assigneeId && item.assigneeId !== userId) {
          try {
            const members = await listMembers(list.groupId);
            const assignerName =
              members.find((m) => m.user.id === userId)?.user.displayName ?? "Quelqu'un";
            const notif = await insertNotification({
              userId: item.assigneeId,
              kind: 'todo_assigned',
              payload: {
                itemId: item.id,
                listId: list.id,
                text: item.text,
                listTitle: list.title,
                assignedByName: assignerName,
              },
              groupId: list.groupId,
              sourceId: item.id,
            });
            if (notif) {
              await publishNexusEvent({
                type: 'notification:created',
                groupId: list.groupId,
                timestamp: Date.now(),
                payload: { notificationId: notif.id, userId: notif.userId, kind: 'todo_assigned' },
              });
            }
          } catch (err) {
            req.log.warn({ err }, 'failed to notify todo_assigned (on create)');
          }
        }
        return { todoItem: itemToDto(item) };
      },
    }),
  );

  // PATCH /todo-items/:itemId
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/todo-items/:itemId',
      params: ItemIdParamsSchema,
      body: UpdateTodoItemBodySchema,
      reply: TodoItemReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const item = await getTodoItem(req.params.itemId);
        if (!item) throw new AppError('RESOURCE_NOT_FOUND');
        const list = await getTodoListById(item.listId);
        if (!list) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(list.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const patch: Parameters<typeof updateTodoItem>[1] = {};
        if (req.body.text !== undefined) patch.text = req.body.text;
        if (req.body.done !== undefined) patch.done = req.body.done;
        if (req.body.assigneeId !== undefined) patch.assigneeId = req.body.assigneeId;
        if (req.body.position !== undefined) patch.position = req.body.position;
        const updated = await updateTodoItem(req.params.itemId, patch);
        // L'event « checked » est plus parlant que « updated » côté client
        // quand seul `done` change. On distingue côté ws-protocol — d'où le
        // if/else explicite (sinon TS infère `'updated'|'checked'` qui ne
        // satisfait pas la discriminated union de `publishNexusEvent`).
        const isChecked =
          req.body.done !== undefined &&
          req.body.text === undefined &&
          req.body.assigneeId === undefined &&
          req.body.position === undefined;
        if (isChecked) {
          await publishNexusEvent({
            type: 'todo_item:checked',
            groupId: list.groupId,
            timestamp: Date.now(),
            payload: { listId: list.id, itemId: updated.id, done: updated.done },
          });
          // ADR-029 : log d'activité, mais uniquement sur passage false→true.
          // Décocher (true→false) est un correctif rare qui ne mérite pas
          // d'apparaître dans la timeline collective.
          if (!item.done && updated.done) {
            await recordActivityWithLookup(
              {
                groupId: list.groupId,
                actorId: userId,
                kind: 'todo_item:checked',
                targetId: updated.id,
                targetType: 'todo_item',
                extraPayload: {
                  targetTitle: list.title,
                  itemText: updated.text,
                },
              },
              req.log,
            );
          }
          // Notifie le créateur de la liste quand l'item est coché par
          // quelqu'un d'autre que lui (passage false → true seulement).
          const wasNotDone = !item.done;
          if (wasNotDone && updated.done && list.createdBy !== userId) {
            try {
              const members = await listMembers(list.groupId);
              const completerName =
                members.find((m) => m.user.id === userId)?.user.displayName ?? "Quelqu'un";
              const notif = await insertNotification({
                userId: list.createdBy,
                kind: 'todo_completed',
                payload: {
                  itemId: updated.id,
                  listId: list.id,
                  text: updated.text,
                  listTitle: list.title,
                  completedByName: completerName,
                },
                groupId: list.groupId,
                sourceId: updated.id,
              });
              if (notif) {
                await publishNexusEvent({
                  type: 'notification:created',
                  groupId: list.groupId,
                  timestamp: Date.now(),
                  payload: {
                    notificationId: notif.id,
                    userId: notif.userId,
                    kind: 'todo_completed',
                  },
                });
              }
            } catch (err) {
              req.log.warn({ err }, 'failed to notify list creator of todo_completed');
            }
          }
        } else {
          await publishNexusEvent({
            type: 'todo_item:updated',
            groupId: list.groupId,
            timestamp: Date.now(),
            payload: { listId: list.id, itemId: updated.id },
          });
        }
        // Si l'assigneeId change vers un autre user (≠ self), on notifie.
        const newAssignee = req.body.assigneeId;
        if (
          newAssignee !== undefined &&
          newAssignee !== null &&
          newAssignee !== item.assigneeId &&
          newAssignee !== userId
        ) {
          let assigneeName: string | undefined;
          try {
            const members = await listMembers(list.groupId);
            const assignerName =
              members.find((m) => m.user.id === userId)?.user.displayName ?? "Quelqu'un";
            assigneeName = members.find((m) => m.user.id === newAssignee)?.user.displayName;
            const notif = await insertNotification({
              userId: newAssignee,
              kind: 'todo_assigned',
              payload: {
                itemId: updated.id,
                listId: list.id,
                text: updated.text,
                listTitle: list.title,
                assignedByName: assignerName,
              },
              groupId: list.groupId,
              sourceId: updated.id,
            });
            if (notif) {
              await publishNexusEvent({
                type: 'notification:created',
                groupId: list.groupId,
                timestamp: Date.now(),
                payload: { notificationId: notif.id, userId: notif.userId, kind: 'todo_assigned' },
              });
            }
          } catch (err) {
            req.log.warn({ err }, 'failed to notify todo_assigned (on patch)');
          }
          // ADR-029 : log d'activité (assignée à un autre user que self).
          await recordActivityWithLookup(
            {
              groupId: list.groupId,
              actorId: userId,
              kind: 'todo_item:assigned',
              targetId: updated.id,
              targetType: 'todo_item',
              extraPayload: {
                targetTitle: list.title,
                itemText: updated.text,
                ...(assigneeName ? { assigneeName } : {}),
              },
            },
            req.log,
          );
        }
        return { todoItem: itemToDto(updated) };
      },
    }),
  );

  // DELETE /todo-items/:itemId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/todo-items/:itemId',
      params: ItemIdParamsSchema,
      reply: DeleteReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const item = await getTodoItem(req.params.itemId);
        if (!item) throw new AppError('RESOURCE_NOT_FOUND');
        const list = await getTodoListById(item.listId);
        if (!list) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(list.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        await deleteTodoItem(req.params.itemId);
        await publishNexusEvent({
          type: 'todo_item:deleted',
          groupId: list.groupId,
          timestamp: Date.now(),
          payload: { listId: list.id, itemId: item.id },
        });
        return { ok: true as const };
      },
    }),
  );

  // GET /public/todos/:slug
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/todos/:slug',
      params: SlugParamsSchema,
      reply: TodoListReplySchema,
      handler: async (req) => {
        const list = await getTodoListBySlug(req.params.slug);
        if (!list) throw new AppError('RESOURCE_NOT_FOUND');
        return { todoList: listToDto(list) };
      },
    }),
  );
};
