/**
 * Routes Polls — CRUD + vote + lecture publique (cf. J5b #39).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/polls
 *   GET    /api/v1/groups/:groupId/polls   (query state)
 *   GET    /api/v1/polls/:pollId
 *   PATCH  /api/v1/polls/:pollId
 *   DELETE /api/v1/polls/:pollId           (createdBy ou admin)
 *   POST   /api/v1/polls/:pollId/vote      ({ optionId, value })
 *   GET    /api/v1/public/polls/:slug
 */
import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
} from '../../core/middlewares/require-group-membership.js';
import { recordActivityWithLookup } from '../activity/repo.js';
import { findMembership } from '../groups/service.js';
import { publishNexusEvent } from '../../ws/nexus-event-bus.js';

import {
  createPoll,
  deletePoll,
  getPollById,
  getPollBySlug,
  listPollsByGroup,
  updatePoll,
  vote,
  type PollWithOptions,
} from './repo.js';
import {
  CreatePollBodySchema,
  DeletePollReplySchema,
  GroupIdParamsSchema,
  ListPollsQuerySchema,
  PollIdParamsSchema,
  PollListReplySchema,
  PollReplySchema,
  SlugParamsSchema,
  UpdatePollBodySchema,
  VoteBodySchema,
  type PollDto,
} from './schemas.js';

import type { FastifyPluginAsync } from 'fastify';

function toDto(p: PollWithOptions): PollDto {
  return {
    id: p.id,
    slug: p.slug,
    groupId: p.groupId,
    tags: p.tags,
    question: p.question,
    multi: p.multi,
    closesAt: p.closesAt ? p.closesAt.toISOString() : null,
    options: p.options.map((o) => ({
      id: o.id,
      pollId: o.pollId,
      label: o.label,
      position: o.position,
      voters: o.voters,
    })),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export const pollsPlugin: FastifyPluginAsync = async (app) => {
  // POST /groups/:groupId/polls
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/polls',
      params: GroupIdParamsSchema,
      body: CreatePollBodySchema,
      reply: PollReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const userId = req.user!.id;
        const created = await createPoll({
          groupId: ctx.groupId,
          tags: req.body.tags ?? [],
          question: req.body.question,
          multi: req.body.multi ?? false,
          closesAt: req.body.closesAt ? new Date(req.body.closesAt) : null,
          options: req.body.options,
          createdBy: userId,
        });
        await publishNexusEvent({
          type: 'poll:created',
          groupId: ctx.groupId,
          timestamp: Date.now(),
          payload: { pollId: created.id },
        });
        // ADR-029 : log d'activité.
        await recordActivityWithLookup(
          {
            groupId: ctx.groupId,
            actorId: userId,
            kind: 'poll:created',
            targetId: created.id,
            targetType: 'poll',
            extraPayload: { targetTitle: created.question },
          },
          req.log,
        );
        return { poll: toDto(created) };
      },
    }),
  );

  // GET /groups/:groupId/polls
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/polls',
      params: GroupIdParamsSchema,
      query: ListPollsQuerySchema,
      reply: PollListReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const filter: { state?: 'open' | 'closed' | 'all' } = {};
        if (req.query.state !== undefined) filter.state = req.query.state;
        const list = await listPollsByGroup(ctx.groupId, filter);
        return { polls: list.map(toDto) };
      },
    }),
  );

  // GET /polls/:pollId
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/polls/:pollId',
      params: PollIdParamsSchema,
      reply: PollReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const poll = await getPollById(req.params.pollId);
        if (!poll) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(poll.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        return { poll: toDto(poll) };
      },
    }),
  );

  // PATCH /polls/:pollId
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/polls/:pollId',
      params: PollIdParamsSchema,
      body: UpdatePollBodySchema,
      reply: PollReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getPollById(req.params.pollId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const patch: Parameters<typeof updatePoll>[1] = {};
        if (req.body.tags !== undefined) patch.tags = req.body.tags;
        if (req.body.question !== undefined) patch.question = req.body.question;
        if (req.body.multi !== undefined) patch.multi = req.body.multi;
        if (req.body.closesAt !== undefined) {
          patch.closesAt = req.body.closesAt ? new Date(req.body.closesAt) : null;
        }
        await updatePoll(req.params.pollId, patch);
        await publishNexusEvent({
          type: 'poll:updated',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { pollId: existing.id },
        });
        // ADR-029 : log d'activité poll:closed si le PATCH passe closesAt
        // dans le passé (clôture explicite). On ne trace que cette transition,
        // pas un simple report de clôture vers une date future.
        const wasOpen = !existing.closesAt || existing.closesAt > new Date();
        const newClosesAt = patch.closesAt;
        if (wasOpen && newClosesAt instanceof Date && newClosesAt <= new Date()) {
          await recordActivityWithLookup(
            {
              groupId: existing.groupId,
              actorId: userId,
              kind: 'poll:closed',
              targetId: existing.id,
              targetType: 'poll',
              extraPayload: { targetTitle: existing.question },
            },
            req.log,
          );
        }
        const full = await getPollById(req.params.pollId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { poll: toDto(full) };
      },
    }),
  );

  // DELETE /polls/:pollId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/polls/:pollId',
      params: PollIdParamsSchema,
      reply: DeletePollReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getPollById(req.params.pollId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        const isOwnerOrAdmin = membership.role === 'owner' || membership.role === 'admin';
        if (existing.createdBy !== userId && !isOwnerOrAdmin) {
          throw new AppError('PERMISSION_DENIED');
        }
        await deletePoll(req.params.pollId);
        await publishNexusEvent({
          type: 'poll:deleted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { pollId: existing.id },
        });
        return { ok: true as const };
      },
    }),
  );

  // POST /polls/:pollId/vote
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/polls/:pollId/vote',
      params: PollIdParamsSchema,
      body: VoteBodySchema,
      reply: PollReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const existing = await getPollById(req.params.pollId);
        if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
        const userId = req.user!.id;
        const membership = await findMembership(existing.groupId, userId);
        if (!membership) throw new AppError('RESOURCE_NOT_FOUND');
        await vote(req.params.pollId, req.body.optionId, userId, req.body.value);
        await publishNexusEvent({
          type: 'poll:voted',
          groupId: existing.groupId,
          timestamp: Date.now(),
          payload: { pollId: existing.id, userId },
        });
        // ADR-029 : log d'activité (uniquement si vote actif, value=true).
        // Un unvote (value=false) n'est pas tracé pour limiter le bruit.
        if (req.body.value) {
          const optionLabel = existing.options.find((o) => o.id === req.body.optionId)?.label ?? '';
          await recordActivityWithLookup(
            {
              groupId: existing.groupId,
              actorId: userId,
              kind: 'poll:voted',
              targetId: existing.id,
              targetType: 'poll',
              extraPayload: { targetTitle: existing.question, optionLabel },
            },
            req.log,
          );
        }
        const full = await getPollById(req.params.pollId);
        if (!full) throw new AppError('INTERNAL_ERROR');
        return { poll: toDto(full) };
      },
    }),
  );

  // GET /public/polls/:slug
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/public/polls/:slug',
      params: SlugParamsSchema,
      reply: PollReplySchema,
      handler: async (req) => {
        const poll = await getPollBySlug(req.params.slug);
        if (!poll) throw new AppError('RESOURCE_NOT_FOUND');
        return { poll: toDto(poll) };
      },
    }),
  );
};
