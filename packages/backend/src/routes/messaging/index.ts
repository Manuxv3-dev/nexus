import { defineRoute } from '../../core/define-route.js';
import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  getGroupContext,
  requireGroupMembership,
  requireGroupRole,
} from '../../core/middlewares/require-group-membership.js';
import { listChannelsForSession } from '../../integrations/core/channel-store.js';
import { publishControl } from '../../integrations/core/event-bus.js';
import { requestRpc } from '../../integrations/core/bridge-rpc.js';
import {
  createSession,
  deleteSession,
  findSessionByExternal,
  findSessionInGroup,
  listSessionsForGroup,
  sessionToView,
  updateSessionStatus,
} from '../../integrations/core/session-store.js';
import {
  buildInstallUrl,
  exchangeCodeForGuildInfo,
  verifyState,
} from '../../integrations/discord/oauth.js';

import {
  ConnectWebviewBodySchema,
  ConnectWebviewReplySchema,
  DeleteSessionReplySchema,
  GroupIdParamsSchema,
  InstallUrlReplySchema,
  ListChannelsReplySchema,
  ChannelMessagesParamsSchema,
  ListMessagesQuerySchema,
  ListMessagesReplySchema,
  ListSessionsReplySchema,
  OauthCallbackQuerySchema,
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
        // Pour les sessions webview-encapsulées (WA/Messenger, cf. ADR-025),
        // pas de bridge worker à notifier — le providerType reste 'whatsapp'
        // ou 'messenger' mais aucun listener n'est attaché. On skip pour
        // éviter de polluer les logs Redis pubsub avec des events orphelins.
        if (session.providerType === 'discord') {
          await publishControl(session.providerType, {
            kind: 'session:removed',
            sessionId: session.id,
          });
        }
        return { ok: true as const };
      },
    }),
  );

  // ===== Webview-encapsulated providers (cf. ADR-022 + ADR-025) ============
  // POST /api/v1/groups/:groupId/messaging/webview-sessions
  // Crée une session WhatsApp/Messenger SANS credentials. L'authentification
  // se fait dans la webview elle-même côté front (QR code WA, login Messenger).
  // Backend stocke juste une "déclaration d'usage" : qui a connecté quel
  // provider à quel groupe, et le pinne en status='connected' (pas de cycle
  // de vie comme Discord, donc pas de bridge worker à dispatcher).
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/groups/:groupId/messaging/webview-sessions',
      params: GroupIdParamsSchema,
      body: ConnectWebviewBodySchema,
      reply: ConnectWebviewReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = requireGroupRole(req, 'admin');
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const { providerType } = req.body;

        // Idempotence : si l'user a déjà déclaré ce provider sur ce groupe,
        // on renvoie la session existante. L'externalId encode (user, group)
        // pour permettre plusieurs users du même groupe d'avoir leur propre
        // session WA/Messenger sans collision.
        const externalId = `webview:${userId}:${ctx.groupId}`;
        const existing = await findSessionByExternal(providerType, externalId);
        if (existing) {
          // Re-pin connected au cas où elle aurait été marquée disconnected
          // (ex : l'user a delete depuis la webview Tauri).
          if (existing.status !== 'connected') {
            await updateSessionStatus(existing.id, {
              kind: 'connected',
              since: new Date().toISOString(),
            });
          }
          const refreshed = (await findSessionInGroup(ctx.groupId, existing.id)) ?? existing;
          return { session: sessionToView(refreshed) };
        }

        const session = await createSession({
          groupId: ctx.groupId,
          providerType,
          externalId,
          displayName: providerType === 'whatsapp' ? 'WhatsApp Web' : 'Messenger',
          createdBy: userId,
        });
        // Pas de credentials → on bascule directement en 'connected'.
        // C'est la convention ADR-025 : pour les sessions webview-encapsulées,
        // 'connected' = "l'user a déclaré utiliser ce provider depuis Nexus",
        // pas "le bridge a un socket actif". `since` = maintenant (création).
        await updateSessionStatus(session.id, {
          kind: 'connected',
          since: new Date().toISOString(),
        });
        const refreshed = (await findSessionInGroup(ctx.groupId, session.id)) ?? session;
        return { session: sessionToView(refreshed) };
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
  //
  // On bypass `defineRoute` pour pouvoir appeler `reply.redirect()` directement :
  // le `defineRoute` impose un `opts.reply.parse(result)` qui n'est pas adapté
  // à un endpoint qui termine la response avec un 302 (sans body JSON).
  app.route({
    method: 'GET',
    url: '/api/v1/messaging/discord/oauth/callback',
    handler: async (req, reply) => {
      const query = OauthCallbackQuerySchema.parse(req.query);
      const { code, state, guild_id } = query;

      // 1. Vérifier signature + fraîcheur du state
      const payload = verifyState(state);

      // 2. Échanger le code (preuve que l'user a complété le flow)
      const guildInfo = await exchangeCodeForGuildInfo(code);

      // 3. Validation cohérence : si guild_id fourni en query, doit matcher
      if (guild_id && guild_id !== guildInfo.guildId) {
        throw new AppError('VALIDATION_ERROR', { reason: 'guild_id_mismatch' });
      }

      // 4. Créer la session — idempotent.
      //
      // L'unique `(provider_type, external_id)` peut déjà être pris :
      //  - même groupe → on réutilise la session existante (re-auth OAuth)
      //  - autre groupe → conflit légitime, on remonte l'erreur
      //
      // Ce comportement est important pour permettre à l'utilisateur de
      // ré-autoriser le bot Discord sans qu'on lui balance un 409.
      const existing = await findSessionByExternal('discord', guildInfo.guildId);
      let session;
      if (existing) {
        if (existing.groupId !== payload.groupId) {
          throw new AppError('RESOURCE_CONFLICT', {
            reason: 'session_already_exists_other_group',
            providerType: 'discord',
            externalId: guildInfo.guildId,
          });
        }
        session = existing;
      } else {
        session = await createSession({
          groupId: payload.groupId,
          providerType: 'discord',
          externalId: guildInfo.guildId,
          displayName: guildInfo.guildName,
          createdBy: payload.userId,
        });
      }

      // 5. Publier la commande de contrôle au worker (re-broadcast OK :
      // le worker l'utilise pour reconnecter / hydrater les credentials).
      await publishControl('discord', {
        kind: 'session:added',
        sessionId: session.id,
      });

      // 6. Rediriger l'utilisateur vers la page OAuth callback du front.
      //
      // Cette page sait qu'elle peut être ouverte en popup : elle envoie un
      // postMessage au parent (Settings) avec le contexte de session et se
      // ferme automatiquement. Si elle est ouverte directement (popup
      // bloquée par le navigateur), elle affiche un message + lien retour.
      const env = loadEnv();
      const target = new URL('/oauth/callback', env.WEB_BASE_URL);
      target.searchParams.set('provider', 'discord');
      target.searchParams.set('sessionId', session.id);
      target.searchParams.set('groupId', payload.groupId);
      void reply.redirect(target.toString(), 302);
    },
  });

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

        // Lecture directe de la table messaging_channels (peuplée par le
        // worker via channel:upsert). On ne passe plus par
        // provider.listChannels() côté HTTP : le client gateway n'existe que
        // dans le process worker (cf. ADR-009 + commit fix architectural).
        const rows = await listChannelsForSession(session.id);
        return {
          channels: rows.map((row) => ({
            id: row.id,
            sessionId: row.sessionId,
            externalChannelId: row.externalChannelId,
            name: row.name,
            channelType: row.channelType,
            isArchived: row.isArchived,
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
      params: ChannelMessagesParamsSchema,
      query: ListMessagesQuerySchema,
      reply: ListMessagesReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        // Délègue au worker du provider via RPC Redis (cf. bridge-rpc.ts).
        // Le client gateway Discord vit dans le process worker et ne peut
        // pas être appelé directement depuis le serveur HTTP (ADR-009).
        const result = (await requestRpc(session.providerType, 'fetchHistory', {
          sessionId: session.id,
          channelExternalId: (req.params as Record<string, string>)['channelId']!,
          ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
          limit: req.query.limit,
        })) as {
          messages: {
            externalId: string;
            authorExternalId: string;
            authorDisplayName: string;
            authorAvatarUrl: string | null;
            content: string;
            replyToExternalId: string | null;
            attachments: unknown[];
            reactions: unknown[];
            isEdited: boolean;
            isDeleted: boolean;
            externalCreatedAt: string;
            externalEditedAt: string | null;
            channelExternalId: string;
          }[];
          nextCursor: string | null;
        };

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
      params: ChannelMessagesParamsSchema,
      body: SendMessageBodySchema,
      reply: SendMessageReplySchema,
      preHandlers: [requireAuth, requireGroupMembership],
      handler: async (req) => {
        const ctx = getGroupContext(req);
        const session = await findSessionInGroup(ctx.groupId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');

        // Delegue au worker du provider via RPC Redis (cf. bridge-rpc.ts).
        const result = await requestRpc(session.providerType, 'sendMessage', {
          sessionId: session.id,
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
