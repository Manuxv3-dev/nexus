/**
 * Routes Polls — CRUD + vote + lecture publique (cf. J5b #39).
 *
 * Endpoints :
 *   POST   /api/v1/groups/:groupId/polls
 *   GET    /api/v1/groups/:groupId/polls   (query state/channelId)
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
    channelId: p.channelId,
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
          channelId: req.body.channelId ?? null,
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
        const filter: { state?: 'open' | 'closed' | 'all'; channelId?: string } = {};
        if (req.query.state !== undefined) filter.state = req.query.state;
        if (req.query.channelId !== undefined) filter.channelId = req.query.channelId;
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
        if (req.body.channelId !== undefined) patch.channelId = req.body.channelId;
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
        const isOwnerOrAdmin =
          membership.role === 'owner' || membership.role === 'admin';
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
