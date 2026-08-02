import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/middlewares/require-auth.js';
import {
  createSession,
  deleteSession,
  findSessionByExternal,
  findSessionForUser,
  listSessionsForUser,
  sessionToView,
  updateSessionStatus,
} from '../../integrations/core/session-store.js';

import {
  ConnectWebviewBodySchema,
  ConnectWebviewReplySchema,
  DeleteSessionReplySchema,
  ListSessionsReplySchema,
  SessionIdParamsSchema,
  WEBVIEW_PROVIDER_LABELS,
} from './schemas.js';

/**
 * Plugin Fastify pour les endpoints de gestion des sessions messageries
 * de l'utilisateur courant.
 *
 * Depuis M1 (post-ADR-027) : sessions scopées USER (pas GROUP). Un user a
 * son compte WhatsApp / Discord / etc. INDÉPENDAMMENT des groupes nexus
 * auxquels il appartient. Les features (events, polls, etc.) restent
 * scopées au groupe.
 *
 * Routes :
 *   GET    /api/v1/me/messaging/sessions
 *   POST   /api/v1/me/messaging/webview-sessions
 *   DELETE /api/v1/me/messaging/sessions/:sessionId
 *
 * Toutes les sessions sont webview-encapsulées (cf. ADR-027). L'auth se
 * fait dans la webview Tauri (QR code, login OAuth) — backend stocke juste
 * une "déclaration d'usage".
 */
export const messagingPlugin: FastifyPluginAsync = async (app) => {
  // ===== Sessions ===========================================================

  // GET /api/v1/me/messaging/sessions
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/me/messaging/sessions',
      reply: ListSessionsReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const sessions = await listSessionsForUser(userId);
        return { sessions: sessions.map(sessionToView) };
      },
    }),
  );

  // DELETE /api/v1/me/messaging/sessions/:sessionId
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/me/messaging/sessions/:sessionId',
      params: SessionIdParamsSchema,
      reply: DeleteSessionReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const session = await findSessionForUser(userId, req.params.sessionId);
        if (!session) throw new AppError('RESOURCE_NOT_FOUND');
        // Toutes les sessions sont webview-encapsulées (ADR-027) — pas de
        // bridge worker à notifier, juste une suppression DB. Les cookies
        // côté webview Tauri restent persistés dans le data_directory tant
        // que l'user n'efface pas la fenêtre Tauri.
        await deleteSession(session.id);
        return { ok: true as const };
      },
    }),
  );

  // POST /api/v1/me/messaging/webview-sessions
  // Crée une session pour n'importe lequel des 12 providers webview
  // supportés. Pas de credentials côté backend : l'authentification se fait
  // dans la webview (QR code WA/Telegram, login OAuth Discord/Slack, etc.).
  // Backend stocke juste une "déclaration d'usage" : qui a connecté quel
  // provider, et la session est pinned en status='connected'.
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/me/messaging/webview-sessions',
      body: ConnectWebviewBodySchema,
      reply: ConnectWebviewReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = req.user?.id;
        if (!userId) throw new AppError('AUTH_NOT_AUTHENTICATED');
        const { providerType } = req.body;

        // Idempotence : si l'user a déjà déclaré ce provider, on renvoie la
        // session existante. L'externalId encode juste l'userId — l'unicité
        // (provider_type, external_id) garantit qu'un même user ne crée pas
        // 2 sessions du même provider.
        const externalId = `webview:${userId}`;
        const existing = await findSessionByExternal(providerType, externalId);
        if (existing) {
          // Re-pin connected au cas où elle aurait été marquée disconnected.
          if (existing.status !== 'connected') {
            await updateSessionStatus(existing.id, {
              kind: 'connected',
              since: new Date().toISOString(),
            });
          }
          const refreshed = (await findSessionForUser(userId, existing.id)) ?? existing;
          return { session: sessionToView(refreshed) };
        }

        const session = await createSession({
          userId,
          providerType,
          externalId,
          displayName: WEBVIEW_PROVIDER_LABELS[providerType],
          createdBy: userId,
        });
        // Pas de credentials → on bascule directement en 'connected'.
        // C'est la convention ADR-025/ADR-027 : 'connected' = "l'user a
        // déclaré utiliser ce provider depuis nexus", pas "le bridge a un
        // socket actif". `since` = maintenant (création).
        await updateSessionStatus(session.id, {
          kind: 'connected',
          since: new Date().toISOString(),
        });
        const refreshed = (await findSessionForUser(userId, session.id)) ?? session;
        return { session: sessionToView(refreshed) };
      },
    }),
  );
};
