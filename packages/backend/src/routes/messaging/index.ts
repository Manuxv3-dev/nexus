import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
  requireGroupRole,
} from '../../core/middlewares/require-group-membership.js';
import { createProvider } from '../../integrations/core/bridge-registry.js';
import { publishControl } from '../../integrations/core/event-bus.js';
import {
  createSession,
  deleteSession,
  findSessionInGroup,
  listSessionsForGroup,
  sessionToView,
} from '../../integrations/core/session-store.js';
import {
  buildInstallUrl,
  exchangeCodeForGuildInfo,
  verifyState,
} from '../../integrations/discord/oauth.js';

import {
  DeleteSessionReplySchema,
  GroupIdParamsSchema,
  InstallUrlReplySchema,
  ListChannelsReplySchema,
  ListMessagesQuerySchema,
  ListMessagesReplySchema,
  ListSessionsReplySchema,
  OauthCallbackQuerySchema,
  OauthCallbackReplySchema,
  SendMessageBodySchema,
  SendMessageReplySchema,
  SessionParamsSchema,
} from './schemas.js';

import type { FastifyPluginAsync } from 'fastify';

/**
 * Plugin Fastify pour les endpoints de gestion des bridges messageries.
 *
 * Routes :
 *   GET    /api/v1/groups/:groupId/messaging/sessions
 *   DELETE /api/v1/groups/:groupId/messaging/sessions/:sessionId    [admin+]
 *   GET    /api/v1/groups/:groupId/messaging/discord/install-url    [admin+]
 *   GET    /api/v1/messaging/discord/oauth/callback                 [public]
 *   GET    /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels
 *   GET    /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages
 *   POST   /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages
 */
export const messagingPlugin: FastifyPluginAsync = async (app) => {
  // ===== Sessions ===========================================================

  // GET /api/v1/groups/:groupId/messaging/sessions
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/messaging/sessions',
      params: GroupIdParamsSchema,
      reply: ListSessionsReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const sessions = await listSessionsForGroup(ctx.groupId);
        return { sessions: sessions.map(sessionToView) };
      },
    }),
  );

  // DELETE /api/v1/groups/:groupId/messaging/sessions/:sessionId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/groups/:groupId/messaging/sessions/:sessionId',
      params: SessionParamsSchema,
      reply: DeleteSessionReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        await deleteSession(session.id);
        await publishControl(session.providerType, {
          kind: 'session:removed',
          sessionId: session.id,
        });
        return { ok: true as const };
      },
    }),
  );

  // ===== Discord OAuth =====================================================

  // GET /api/v1/groups/:groupId/messaging/discord/install-url
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/messaging/discord/install-url',
      params: GroupIdParamsSchema,
      reply: InstallUrlReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const installUrl = buildInstallUrl({ groupId: ctx.groupId, userId });
        return { installUrl };
      },
    }),
  );

  // GET /api/v1/messaging/discord/oauth/callback (public — Discord redirige ici)
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/messaging/discord/oauth/callback',
      query: OauthCallbackQuerySchema,
      reply: OauthCallbackReplySchema,
      handler: async (req) => {
        const { code, state, guild_id } = req.query;

        // 1. Vérifier signature + fraîcheur du state
        const payload = verifyState(state);

        // 2. Échanger le code (preuve que l'user a complété le flow)
        const guildInfo = await exchangeCodeForGuildInfo(code);

        // 3. Validation cohérence : si guild_id fourni en query, doit matcher
        if (guild_id && guild_id !== guildInfo.guildId) {
          throw new AppError('VALIDATION_ERROR', { reason: 'guild_id_mismatch' });
        }

        // 4. Créer la session (anti-leak : (provider_type, external_id) unique)
        const session = await createSession({
          groupId: payload.groupId,
          providerType: 'discord',
          externalId: guildInfo.guildId,
          displayName: guildInfo.guildName,
          createdBy: payload.userId,
        });

        // 5. Publier la commande de contrôle au worker
        await publishControl('discord', {
          kind: 'session:added',
          sessionId: session.id,
        });

        // 6. Renvoyer une URL de redirection vers la web app (UI confirmera)
        const publicBaseUrl = process.env['PUBLIC_BASE_URL'] ?? 'http://127.0.0.1:3000';
        const redirectUrl = `${publicBaseUrl}/groups/${payload.groupId}/messaging/connected?provider=discord&sessionId=${session.id}`;

        return { ok: true as const, redirectUrl };
      },
    }),
  );

  // ===== Channels ==========================================================

  // GET /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/messaging/sessions/:sessionId/channels',
      params: SessionParamsSchema,
      reply: ListChannelsReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        const provider = createProvider(session.providerType, session);
        const channels = await provider.listChannels();
        return {
          channels: channels.map((c) => ({
            id: c.externalId, // pas d'UUID Nexus persistant à ce stade
            sessionId: session.id,
            externalChannelId: c.externalId,
            name: c.name,
            channelType: c.channelType,
            isArchived: c.isArchived,
          })),
        };
      },
    }),
  );

  // GET /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages',
      params: SessionParamsSchema.extend({}),
      query: ListMessagesQuerySchema,
      reply: ListMessagesReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        const provider = createProvider(session.providerType, session);
        const result = await provider.fetchHistory({
          channelExternalId: (req.params as Record<string, string>)['channelId']!,
          ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
          limit: req.query.limit,
        });

        return {
          messages: result.messages.map((m) => ({
            id: m.externalId, // pas d'UUID local persistant à ce stade
            externalMessageId: m.externalId,
            externalAuthorId: m.authorExternalId,
            authorDisplayName: m.authorDisplayName,
            authorAvatarUrl: m.authorAvatarUrl,
            content: m.content,
            replyToExternalId: m.replyToExternalId,
            attachments: m.attachments,
            reactions: m.reactions,
            isEdited: m.isEdited,
            isDeleted: m.isDeleted,
            externalCreatedAt: m.externalCreatedAt,
            externalEditedAt: m.externalEditedAt,
          })),
          nextCursor: result.nextCursor,
        };
      },
    }),
  );

  // POST /api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/messaging/sessions/:sessionId/channels/:channelId/messages',
      params: SessionParamsSchema.extend({}),
      body: SendMessageBodySchema,
      reply: SendMessageReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        const provider = createProvider(session.providerType, session);
        if (!provider.capabilities.sendMessage) {
          throw new AppError('VALIDATION_ERROR', { reason: 'send_not_supported' });
        }

        const result = await provider.sendMessage({
          channelExternalId: (req.params as Record<string, string>)['channelId']!,
          content: req.body.content,
          ...(req.body.replyToExternalId
            ? { replyToExternalId: req.body.replyToExternalId }
            : {}),
        });

        return {
          externalMessageId: result.externalMessageId,
          sentAt: result.sentAt,
        };
      },
    }),
  );
};
