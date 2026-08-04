/**
 * Repository Push — accès Drizzle à la table `push_subscriptions`
 * (cf. MAN-142, phase 1 de MAN-24 « notifications push PWA »).
 *
 * Garde les routes Fastify minces (validation + auth + appel repo).
 */
import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import { pushSubscriptions } from '../../db/schema/index.js';

export interface SubscribeUserInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Upsert un abonnement push pour `userId`.
 *
 * `endpoint` est UNIQUE en DB (cf. schema) : un re-subscribe sur le même
 * endpoint (même navigateur/device, clés potentiellement renouvelées, ou
 * changement de compte sur ce navigateur) met à jour la ligne existante
 * plutôt que d'en créer une nouvelle. `previewEnabled` n'est jamais réécrit
 * ici — c'est un réglage utilisateur indépendant du cycle de vie de
 * l'abonnement, un re-subscribe ne doit pas le reset à sa valeur par défaut.
 */
export async function subscribeUser(userId: string, input: SubscribeUserInput): Promise<void> {
  const db = getDb();
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
}

/**
 * Supprime l'abonnement push `endpoint` s'il appartient à `userId`.
 *
 * Anti-leak (même pattern que `markNotificationRead` dans
 * `routes/notifications/repo.ts`) : si l'endpoint appartient à un autre
 * user, la clause WHERE ne matche aucune ligne — 0 suppression, pas
 * d'erreur. Le caller ne doit pas exposer la distinction "supprimé" vs
 * "pas trouvé/pas à toi" dans la réponse HTTP.
 *
 * Renvoie `true` si une ligne a été supprimée.
 */
export async function unsubscribeUser(userId: string, endpoint: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
}
