/**
 * Routes Expenses — CRUD + settle de part personnelle + lecture publique
 * (cf. J5b #40).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/expenses
 *   GET    /api/v1/groups/:groupId/expenses        (?state=open|settled|all)
 *   GET    /api/v1/expenses/:expenseId
 *   PATCH  /api/v1/expenses/:expenseId
 *   DELETE /api/v1/expenses/:expenseId             (paidBy ou admin)
 *   POST   /api/v1/expenses/:expenseId/settle      ({ settled: bool }) → règle MA part
 *   GET    /api/v1/public/expenses/:slug
 *
 * Validation métier (côté service) :
 *  - Tous les `userId` cités dans les shares + `paidBy` doivent être membres
 *    du groupe propriétaire de l'expense (anti-cross-group leakage).
 *  - Somme des shares == amountCents.
 *  - Pour POST /settle : on ne peut régler QUE sa propre part. Pas de
 *    "marquer pour quelqu'un d'autre" — pour ça il faudra POST /settle-other
 *    en V2 si demandé.
 */
import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
} from '../../core/middlewares/require-group-membership.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';
import { recordActivityWithLookup } from '../activity/repo.js';
import { findMembership, listMembers } from '../groups/service.js';
import { insertNotificationsBulk } from '../notifications/repo.js';

import {
  createExpense,
  deleteExpense,
  getExpenseById,
  getExpenseBySlug,
  listExpensesByGroup,
  setShareSettled,
  updateExpense,
  type ExpenseWithShares,
} from './repo.js';
import {
  CreateExpenseBodySchema,
  DeleteExpenseReplySchema,
  ExpenseIdParamsSchema,
  ExpenseListReplySchema,
  ExpenseReplySchema,
  GroupIdParamsSchema,
  ListExpensesQuerySchema,
  SettleShareBodySchema,
  SlugParamsSchema,
  UpdateExpenseBodySchema,
  type ExpenseDto,
} from './schemas.js';

function toDto(e: ExpenseWithShares): ExpenseDto {
  return {
    id: e.id,
    slug: e.slug,
    groupId: e.groupId,
    tags: e.tags,
    description: e.description,
    amountCents: e.amountCents,
    currency: e.currency,
    paidBy: e.paidBy,
    settledAt: e.settledAt ? e.settledAt.toISOString() : null,
    shares: e.shares.map((s) => ({
      expenseId: s.expenseId,
      userId: s.userId,
      shareCents: s.shareCents,
      isSettled: s.isSettled,
      settledAt: s.settledAt ? s.settledAt.toISOString() : null,
    })),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/**
 * Vérifie que tous les userIds (paidBy + shares.userId) sont bien membres
 * du groupe. Throw VALIDATION_ERROR sinon.
 */
async function assertAllMembers(groupId: string, userIds: string[]): Promise<void> {
  const members = await listMembers(groupId);
  const memberIds = new Set(members.map((m) => m.member.userId));
  for (const id of userIds) {
    if (!memberIds.has(id)) {
      throw new AppError('VALIDATION_ERROR', { reason: 'user_not_member', userId: id });
    }
  }
}

export const expensesPlugin: FastifyPluginAsync = async (app) => {
  // POST /groups/:groupId/expenses
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/expenses',
      params: GroupIdParamsSchema,
      body: CreateExpenseBodySchema,
      reply: ExpenseReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const userIds = [req.body.paidBy, ...req.body.shares.map((s) => s.userId)];
        await assertAllMembers(ctx.groupId, userIds);
        const created = await createExpense({
          groupId: ctx.groupId,
          tags: req.body.tags ?? [],
          description: req.body.description,
          amountCents: req.body.amountCents,
          currency: req.body.currency,
          paidBy: req.body.paidBy,
          shares: req.body.shares,
        });
        await publishNexusEvent({
          type: 'expense:added',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { expenseId: created.id },
        });
        // ADR-029 : log d'activité. L'actor est `paidBy`, pas
        // l'utilisateur qui a appelé la route — un user peut créer une
        // dépense pour le compte d'un autre payeur.
        await recordActivityWithLookup(
          {
            groupId: ctx.groupId,
            actorId: req.body.paidBy,
            kind: 'expense:added',
            targetId: created.id,
            targetType: 'expense',
            extraPayload: {
              targetTitle: req.body.description,
              amountCents: req.body.amountCents,
              currency: req.body.currency,
            },
          },
          req.log,
        );
        // Notifie les co-payeurs (sauf le payeur) qu'ils ont une part à régler.
        try {
          const allMembers = await listMembers(ctx.groupId);
          const payerName =
            allMembers.find((m) => m.user.id === req.body.paidBy)?.user.displayName ?? "Quelqu'un";
          const recipients = req.body.shares.filter(
            (s) => s.userId !== req.body.paidBy && s.shareCents > 0,
          );
          if (recipients.length > 0) {
            const notifs = await insertNotificationsBulk(
              recipients.map((s) => ({
                userId: s.userId,
                kind: 'expense_added' as const,
                payload: {
                  expenseId: created.id,
                  description: req.body.description,
                  amountCents: req.body.amountCents,
                  currency: req.body.currency,
                  shareCents: s.shareCents,
                  paidByName: payerName,
                },
                groupId: ctx.groupId,
                sourceId: created.id,
              })),
            );
            for (const n of notifs) {
              await publishNexusEvent({
                type: 'notification:created',
                groupId: ctx.groupId,
                timestamp: Date.now(),
                payload: { notificationId: n.id, userId: n.userId, kind: 'expense_added' },
              });
            }
          }
        } catch (err) {
          req.log.warn({ err }, 'failed to fan-out expense_added notifications');
        }
        return { expense: toDto(created) };
      },
    }),
  );

  // GET /groups/:groupId/expenses
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/expenses',
      params: GroupIdParamsSchema,
      query: ListExpensesQuerySchema,
      reply: ExpenseListReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const filter: { state?: 'open' | 'settled' | 'all' } = {};
        if (req.query.state !== undefined) filter.state = req.query.state;
        const list = await listExpensesByGroup(ctx.groupId, filter);
        return { expenses: list.map(toDto) };
      },
    }),
  );

  // GET /expenses/:expenseId
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/expenses/:expenseId',
      params: ExpenseIdParamsSchema,
      reply: ExpenseReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const expense = await getExpenseById(req.params.expenseId);
        if (!expense) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(expense.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        return { expense: toDto(expense) };
      },
    }),
  );

  // PATCH /expenses/:expenseId
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/expenses/:expenseId',
      params: ExpenseIdParamsSchema,
      body: UpdateExpenseBodySchema,
      reply: ExpenseReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getExpenseById(req.params.expenseId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        // Seuls paidBy ou admin/owner peuvent éditer.
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.paidBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        // Re-vérifie l'appartenance des userIds touchés au groupe.
        const userIds: string[] = [];
        if (req.body.paidBy) userIds.push(req.body.paidBy);
        if (req.body.shares) userIds.push(...req.body.shares.map((s) => s.userId));
        if (userIds.length > 0) {
          await assertAllMembers(existing.groupId, userIds);
        }

        const patch: Parameters<typeof updateExpense>[1] = {};
        if (req.body.tags !== undefined) patch.tags = req.body.tags;
        if (req.body.description !== undefined) patch.description = req.body.description;
        if (req.body.amountCents !== undefined) patch.amountCents = req.body.amountCents;
        if (req.body.currency !== undefined) patch.currency = req.body.currency;
        if (req.body.paidBy !== undefined) patch.paidBy = req.body.paidBy;
        if (req.body.shares !== undefined) patch.shares = req.body.shares;
        await updateExpense(req.params.expenseId, patch);
        await publishNexusEvent({
          type: 'expense:updated',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { expenseId: existing.id },
        });
        const full = await getExpenseById(req.params.expenseId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { expense: toDto(full) };
      },
    }),
  );

  // DELETE /expenses/:expenseId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/expenses/:expenseId',
      params: ExpenseIdParamsSchema,
      reply: DeleteExpenseReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getExpenseById(req.params.expenseId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.paidBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        await deleteExpense(req.params.expenseId);
        await publishNexusEvent({
          type: 'expense:deleted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { expenseId: existing.id },
        });
        return { ok: true as const };
      },
    }),
  );

  // POST /expenses/:expenseId/settle — règle MA part
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/expenses/:expenseId/settle',
      params: ExpenseIdParamsSchema,
      body: SettleShareBodySchema,
      reply: ExpenseReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getExpenseById(req.params.expenseId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        // Vérifie qu'il a bien une share dans cette expense.
        const myShare = existing.shares.find((s) => s.userId === userId);
        if (!myShare) {
          throw new AppError('VALIDATION_ERROR', { reason: 'no_share_for_user' });
        }
        await setShareSettled(req.params.expenseId, userId, req.body.settled);
        await publishNexusEvent({
          type: 'expense:settled',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { expenseId: existing.id, userId },
        });
        // ADR-029 : log d'activité expense:settled (uniquement le passage à
        // settled=true ; un "unsettle" est un correctif rare qui n'a pas à
        // alimenter la timeline collective).
        if (req.body.settled) {
          await recordActivityWithLookup(
            {
              groupId: existing.groupId,
              actorId: userId,
              kind: 'expense:settled',
              targetId: existing.id,
              targetType: 'expense',
              extraPayload: {
                targetTitle: existing.description,
                amountCents: myShare.shareCents,
                currency: existing.currency,
              },
            },
            req.log,
          );
        }
        const full = await getExpenseById(req.params.expenseId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { expense: toDto(full) };
      },
    }),
  );

  // GET /public/expenses/:slug
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/expenses/:slug',
      params: SlugParamsSchema,
      reply: ExpenseReplySchema,
      handler: async (req) => {
        const expense = await getExpenseBySlug(req.params.slug);
        if (!expense) throw new AppError('RESOURCE_NOT_FOUND');
        return { expense: toDto(expense) };
      },
    }),
  );
};
