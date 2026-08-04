/**
 * Schemas Zod pour les routes push (cf. MAN-142, phase 1 de MAN-24
 * « notifications push PWA »).
 */
import { z } from 'zod';

/** Body de `POST /push/subscribe` — shape du `PushSubscription` navigateur. */
export const PushSubscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscribeBody = z.infer<typeof PushSubscribeBodySchema>;

/** Body de `DELETE /push/subscribe` — identifie l'abonnement à retirer. */
export const PushUnsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBodySchema>;

/** Reply commune de subscribe/unsubscribe — pas de détail exposé (anti-leak). */
export const PushOkReplySchema = z.object({
  ok: z.literal(true),
});

/** Reply de `GET /push/vapid-public-key`. */
export const VapidPublicKeyReplySchema = z.object({
  publicKey: z.string().min(1),
});
