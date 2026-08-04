/**
 * Routes Push — souscription/désinscription Web Push + clé VAPID publique
 * (cf. MAN-142, phase 1 de MAN-24 « notifications push PWA »).
 *
 * Endpoints :
 *   GET    /api/v1/push/vapid-public-key
 *   POST   /api/v1/push/subscribe
 *   PATCH  /api/v1/push/subscribe
 *   DELETE /api/v1/push/subscribe
 *
 * L'envoi effectif des push (via `web-push` + `VAPID_PRIVATE_KEY`, déclenché
 * par les producteurs de notifications) est hors scope de cette phase —
 * cf. MAN-142 phase suivante.
 */
import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';
import { loadEnv } from '../../core/env.js';
import { AppError } from '../../core/errors.js';
import { getAuthUser, requireAuth } from '../../core/middlewares/require-auth.js';

import { subscribeUser, unsubscribeUser, updatePreviewPreference } from './repo.js';
import {
  PushOkReplySchema,
  PushSubscribeBodySchema,
  PushUnsubscribeBodySchema,
  PushUpdatePreviewBodySchema,
  VapidPublicKeyReplySchema,
} from './schemas.js';

export const pushPlugin: FastifyPluginAsync = async (app) => {
  // ----- GET /api/v1/push/vapid-public-key --------------------------------
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
      reply: VapidPublicKeyReplySchema,
      preHandlers: [requireAuth],
      // `handler` doit renvoyer une Promise (contrat `defineRoute`) ; cette
      // route lit uniquement `loadEnv()` (synchrone), donc pas d'await interne.
      // eslint-disable-next-line @typescript-eslint/require-await
      handler: async () => {
        const { VAPID_PUBLIC_KEY } = loadEnv();
        if (!VAPID_PUBLIC_KEY) {
          // Erreur explicite plutôt qu'un `publicKey: undefined` silencieux
          // qui ferait échouer le PushManager.subscribe() côté client sans
          // diagnostic clair.
          throw new AppError('INTERNAL_ERROR', { reason: 'vapid_public_key_missing' });
        }
        return { publicKey: VAPID_PUBLIC_KEY };
      },
    }),
  );

  // ----- POST /api/v1/push/subscribe ---------------------------------------
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/push/subscribe',
      body: PushSubscribeBodySchema,
      reply: PushOkReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = getAuthUser(req).id;
        await subscribeUser(userId, req.body);
        return { ok: true as const };
      },
    }),
  );

  // ----- PATCH /api/v1/push/subscribe ---------------------------------------
  // Même route que subscribe/unsubscribe, méthode différente (cohérent avec
  // le style REST déjà en place) : `endpoint` identifie la souscription à
  // modifier, ici son réglage "Aperçu" (MAN-145 phase 4).
  await app.register(
    defineRoute({
      method: 'PATCH',
      url: '/api/v1/push/subscribe',
      body: PushUpdatePreviewBodySchema,
      reply: PushOkReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = getAuthUser(req).id;
        // Anti-leak : même comportement que DELETE — ne pas différencier
        // "modifié" vs "pas trouvé/pas à toi" dans la réponse HTTP.
        await updatePreviewPreference(userId, req.body.endpoint, req.body.previewEnabled);
        return { ok: true as const };
      },
    }),
  );

  // ----- DELETE /api/v1/push/subscribe -------------------------------------
  await app.register(
    defineRoute({
      method: 'DELETE',
      url: '/api/v1/push/subscribe',
      body: PushUnsubscribeBodySchema,
      reply: PushOkReplySchema,
      preHandlers: [requireAuth],
      handler: async (req) => {
        const userId = getAuthUser(req).id;
        // Anti-leak : le résultat (supprimé vs pas trouvé/appartient à un
        // autre user) n'est jamais différencié dans la réponse — cf. repo.
        await unsubscribeUser(userId, req.body.endpoint);
        return { ok: true as const };
      },
    }),
  );
};
