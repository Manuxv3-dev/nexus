/**
 * Repository Push — accès Drizzle à la table `push_subscriptions` +
 * envoi effectif des notifications Web Push (cf. MAN-142, phases 1 et 3 de
 * MAN-24 « notifications push PWA »).
 *
 * Garde les routes Fastify minces (validation + auth + appel repo).
 */
import {
  NotificationKindSchema,
  notificationKindToPane,
  type NotificationKind,
  type NotificationNavPane,
} from '@nexus/shared';
import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';

import { loadEnv } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { getDb } from '../../db/client.js';
import {
  pushSubscriptions,
  type PushSubscription as PushSubscriptionRow,
} from '../../db/schema/index.js';

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

/**
 * Met à jour le réglage "Aperçu" (`previewEnabled`) de l'abonnement
 * `endpoint` s'il appartient à `userId` (cf. MAN-145 phase 4 : toggle Settings
 * persisté par appareil, une souscription = un device).
 *
 * Anti-leak, même pattern que `unsubscribeUser` : si l'endpoint appartient à
 * un autre user, la clause WHERE ne matche aucune ligne — 0 mise à jour, pas
 * d'erreur. Le caller ne doit pas exposer la distinction "modifié" vs "pas
 * trouvé/pas à toi" dans la réponse HTTP.
 *
 * Renvoie `true` si une ligne a été modifiée.
 */
export async function updatePreviewPreference(
  userId: string,
  endpoint: string,
  previewEnabled: boolean,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(pushSubscriptions)
    .set({ previewEnabled })
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
}

/**
 * Libellé générique par `kind`, utilisé pour le `body` du push tant que le
 * contenu détaillé (phase 4 de MAN-24) n'est pas branché. Volontairement
 * minimal : pas de détail métier ici (le deep-link vit dans `data`, cf.
 * `PushPayload`).
 *
 * Typé `Record<NotificationKind, string>` (et non `Record<string, string>`) :
 * ajouter un kind à `NotificationKindSchema` sans lui donner de libellé ici
 * doit casser le typecheck, pas dégrader silencieusement le push en
 * « Nouvelle activité ».
 */
const GENERIC_BODY_BY_KIND: Record<NotificationKind, string> = {
  event_reminder: 'Un événement approche',
  event_rsvp_requested: 'Une réponse est attendue',
  event_rsvp_received: 'Nouvelle réponse à un événement',
  expense_added: 'Nouvelle dépense partagée',
  todo_assigned: 'Une tâche vous a été assignée',
  todo_completed: 'Une tâche a été complétée',
};

/** Shape du payload Web Push envoyé au navigateur (JSON.stringify avant `sendNotification`). */
export interface PushPayload {
  title: string;
  body: string;
  /**
   * Données de deep-link consommées par le service worker (MAN-143 Phase 3)
   * pour router le clic sur la notif vers le bon panel in-app.
   */
  data: {
    /** NULL pour une notif cross-group (cf. `InsertNotificationInput.groupId`). */
    groupId: string | null;
    pane: NotificationNavPane;
    sourceId: string | null;
  };
}

/**
 * Contenu générique affiché quand la souscription a l'aperçu désactivé
 * (`previewEnabled = false`, cf. MAN-145 phase 4) : ni titre ni corps ne
 * doivent laisser deviner le contenu de la notif sur un appareil dont
 * l'utilisateur ne veut pas de contenu visible (écran de veille, etc.).
 * `data` (deep-link) n'est PAS concerné — il ne s'affiche jamais à l'écran.
 */
const GENERIC_PREVIEW_DISABLED_BODY = 'Nouvelle activité sur Nexus';

/**
 * Construit le payload Web Push (title/body/data) à partir d'un `PushTarget`
 * et du `previewEnabled` de LA souscription qui recevra ce payload.
 *
 * `previewEnabled` est un réglage par souscription/appareil (MAN-145 phase 4,
 * `updatePreviewPreference`), pas global au user : deux devices du même user
 * peuvent recevoir un contenu différent pour la même notif. `false` bascule
 * `title`/`body` sur un contenu générique fixe ; `data` (deep-link, MAN-143
 * Phase 2) reste toujours présent et identique — masquer le texte ne doit
 * pas casser le clic sur la notif.
 *
 * `notifications.kind` est une colonne `text` (pas un enum PG) : le `kind`
 * arrive donc typé `string` depuis la DB. On le repasse par
 * `NotificationKindSchema` (Zod = source de vérité, cf. CLAUDE.md) plutôt que
 * par un cast, avec un fallback générique pour une valeur inconnue — `pane`
 * suit le même fallback via `notificationKindToPane` ('home').
 *
 * Exportée (au-delà de l'usage interne à `sendPushToUsers`) pour le test
 * d'acceptation bout-en-bout du deep-link push (MAN-143 Phase 2 Task 5,
 * `pushDeepLink.acceptance.test.ts`) — pure fonction, aucun effet de bord.
 */
export function buildPushPayload(target: PushTarget, previewEnabled: boolean): PushPayload {
  const parsed = NotificationKindSchema.safeParse(target.kind);
  const pane = parsed.success ? notificationKindToPane(parsed.data) : 'home';
  const fullBody = parsed.success ? GENERIC_BODY_BY_KIND[parsed.data] : 'Nouvelle activité';
  return {
    title: 'Nexus',
    body: previewEnabled ? fullBody : GENERIC_PREVIEW_DISABLED_BODY,
    data: {
      groupId: target.groupId ?? null,
      pane,
      sourceId: target.sourceId ?? null,
    },
  };
}

let vapidConfigured = false;
let vapidMissingWarned = false;

/**
 * Configure `web-push` avec les clés VAPID (une seule fois par process).
 * Renvoie `false` sans rien configurer si les clés sont absentes de l'env
 * (dev/CI sans push configuré) — auquel cas `sendPushToUsers` no-ope.
 *
 * Le warning « clés absentes » n'est émis qu'une fois : cette fonction est
 * appelée à chaque insertion de notification (choke point), un warn par notif
 * noierait les logs de tout environnement sans push configuré.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = loadEnv();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    if (!vapidMissingWarned) {
      vapidMissingWarned = true;
      logger.warn('push: VAPID keys missing — push notifications disabled');
    }
    return false;
  }
  // Subject "mailto:" requis par la spec Web Push (contact en cas d'abus
  // signalé par un push service). Pas de var d'env dédiée pour l'instant.
  webpush.setVapidDetails('mailto:support@nexusapp.chat', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

/**
 * Timeout socket (ms) des requêtes vers le push service. `web-push` n'en pose
 * AUCUN par défaut : sans ça, un push service qui accepte la connexion puis ne
 * répond jamais bloquerait indéfiniment l'appelant — or l'appelant est le
 * choke point d'insertion des notifs, lui-même sur le chemin de requêtes HTTP
 * métier (POST /events, POST /expenses...). Le push est best-effort : mieux
 * vaut l'abandonner que faire traîner la mutation qui l'a déclenché.
 */
const PUSH_SEND_TIMEOUT_MS = 10_000;

/** Envoi unitaire, best-effort : toute erreur est loguée, jamais relancée. */
async function sendToSubscription(sub: PushSubscriptionRow, payload: string): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { timeout: PUSH_SEND_TIMEOUT_MS },
    );
  } catch (err) {
    logger.warn(
      { err, userId: sub.userId, subscriptionId: sub.id },
      'push: send failed for subscription',
    );
  }
}

export interface SendPushNotifInput {
  kind: string;
  /** Payload JSONB de la notif source — pas encore exploité (phase 4, contenu détaillé). */
  payload: Record<string, unknown>;
  /** Group concerné, pour le deep-link. NULL pour une notif cross-group. */
  groupId?: string | null;
  /** ID de la ressource source (event, expense, todo_item), pour le deep-link. */
  sourceId?: string | null;
}

/**
 * Une notification à pousser : le destinataire + le `kind` qui donne le
 * libellé + `groupId`/`sourceId` qui alimentent `data` (deep-link, MAN-143
 * Phase 2) dans le payload construit par `buildPushPayload`.
 */
export interface PushTarget {
  userId: string;
  kind: string;
  groupId?: string | null;
  sourceId?: string | null;
}

/**
 * Envoie un push à tous les devices abonnés des destinataires de `targets`.
 *
 * Best-effort : appelé depuis le choke point d'insertion des notifs
 * (`insertNotification`/`insertNotificationsBulk`), une erreur d'envoi (une
 * subscription morte, un push service indisponible, ...) est loguée et n'est
 * jamais relancée — un push raté ne doit jamais faire échouer l'écriture de
 * la notif en base.
 *
 * Prend une LISTE de targets et non un seul user : le fan-out d'un rappel
 * d'événement à tout un groupe passe par `insertNotificationsBulk`, et une
 * requête par destinataire y serait un N+1 sur le chemin d'une requête HTTP.
 * Une seule requête `IN (...)` couvre tout le lot.
 *
 * Titre/corps restent génériques par `kind` (cf. `buildPushPayload`) --
 * aucun contenu métier détaillé n'est branché. Le payload est construit
 * PAR SOUSCRIPTION (pas une fois pour tout le user) : `previewEnabled` est un
 * réglage par device (MAN-145 phase 4), deux souscriptions du même user
 * peuvent donc recevoir un contenu différent pour la même notif. `data` porte
 * le deep-link (groupId/pane/sourceId, MAN-143 Phase 2), consommé par le
 * service worker au clic. Le cleanup fin des subscriptions mortes (404/410)
 * est hors scope ici.
 */
export async function sendPushToUsers(targets: PushTarget[]): Promise<void> {
  if (targets.length === 0) return;
  // Avant la requête DB : sans clés VAPID rien ne partira, inutile d'aller
  // lire `push_subscriptions` à chaque notification insérée.
  if (!ensureVapidConfigured()) return;

  const userIds = [...new Set(targets.map((t) => t.userId))];
  const db = getDb();
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
  if (subs.length === 0) return;

  const subsByUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of subs) {
    const existing = subsByUser.get(sub.userId);
    if (existing) existing.push(sub);
    else subsByUser.set(sub.userId, [sub]);
  }

  await Promise.all(
    targets.flatMap((target) => {
      const userSubs = subsByUser.get(target.userId);
      if (!userSubs || userSubs.length === 0) return [];
      return userSubs.map((sub) => {
        const payload = JSON.stringify(buildPushPayload(target, sub.previewEnabled));
        return sendToSubscription(sub, payload);
      });
    }),
  );
}

/** Raccourci mono-destinataire de `sendPushToUsers`. */
export async function sendPushToUser(userId: string, notif: SendPushNotifInput): Promise<void> {
  await sendPushToUsers([
    { userId, kind: notif.kind, groupId: notif.groupId ?? null, sourceId: notif.sourceId ?? null },
  ]);
}
