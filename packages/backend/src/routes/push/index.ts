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
 * par les producteurs de notifications au choke point d'insertion des notifs)
 * vit dans `repo.ts` (`sendPushToUsers`/`sendToSubscription`), pas ici — cf.
 * MAN-142 phase 3 et MAN-146 phase 5 (nettoyage des souscriptions 404/410).
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
  // PAS de `requireAuth` — volontaire. La clé VAPID PUBLIQUE n'est pas un
  // secret : elle est distribuée à même chaque abonnement push (visible dans
  // n'importe quel outil réseau du navigateur) et ne dévoile aucune donnée
  // utilisateur ni aucun état serveur ; seule `VAPID_PRIVATE_KEY` (jamais
  // exposée) doit rester confidentielle. L'exiger cassait le fallback du
  // service worker sur `pushsubscriptionchange` (`public/sw-push.js`) : un SW
  // n'a pas de bearer token à joindre (il vit hors du contexte de page), donc
  // l'appel se prenait un 401 systématique — code mort avant ce correctif.
  await app.register(
    defineRoute({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
      reply: VapidPublicKeyReplySchema,
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
        const { id: userId, sessionId } = getAuthUser(req);
        // L'abonnement est lié à la session qui le crée (cf. abf71bf4) : il
        // ne recevra que tant qu'elle vit. `sessionId` peut être null pour un
        // JWT émis avant le déploiement du claim — l'abonnement est alors
        // d'héritage, il se liera au prochain toggle.
        await subscribeUser(userId, { ...req.body, sessionId });
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
