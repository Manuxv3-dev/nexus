/**
 * Schemas Zod pour les routes push (cf. MAN-142, phase 1 de MAN-24
 * « notifications push PWA »).
 */
import { z } from 'zod';

/**
 * Hôtes refusés pour un endpoint push.
 *
 * L'endpoint est une URL fournie par le CLIENT vers laquelle le backend fait
 * un POST à chaque notification (cf. `sendPushToUsers`). Un simple
 * `z.string().url()` accepterait `http://127.0.0.1:6379/`, `http://redis:6379/`
 * ou `http://169.254.169.254/...` : n'importe quel compte authentifié ferait
 * alors du backend un proxy SSRF aveugle vers le réseau interne du VPS (et un
 * amplificateur de trafic vers un tiers). On exige donc https + un hôte qui
 * n'est pas loopback/privé/link-local.
 *
 * Reste hors de portée de ce contrôle : un nom public qui résout vers une IP
 * privée (DNS rebinding). Le vérifier demanderait de résoudre au moment de
 * l'envoi, pas de la validation — à traiter le jour où le push sortira du
 * best-effort (cf. MAN-24 phases suivantes).
 */
const FORBIDDEN_ENDPOINT_HOSTS: RegExp[] = [
  /^localhost$/i,
  /\.(localhost|local|internal|home|lan)$/i,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // ULA IPv6 fc00::/7
  /^\[?fe80:/i, // link-local IPv6
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local IPv4 (metadata cloud)
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * Endpoint Web Push accepté à l'abonnement : https, hôte public.
 *
 * Volontairement PAS une allowlist des hôtes de push services connus (FCM,
 * Mozilla, WNS, Apple) : elle casserait silencieusement le push pour tout
 * navigateur qui change de domaine d'endpoint, pour un gain marginal.
 */
export const PushEndpointSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endpoint invalide' });
      return;
    }
    if (url.protocol !== 'https:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endpoint doit être en https' });
    }
    if (FORBIDDEN_ENDPOINT_HOSTS.some((re) => re.test(url.hostname))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "hôte d'endpoint interdit" });
    }
  });

/**
 * Body de `POST /push/subscribe` — shape du `PushSubscription` navigateur.
 *
 * `previewEnabled` est OPTIONNEL et ne vaut qu'à la création de la ligne :
 * le client envoie la préférence "Aperçu" déjà choisie sur cet appareil (elle
 * peut avoir été réglée avant même d'activer le push, cf. `readPushPreview`
 * côté web) pour que la nouvelle souscription ne reparte pas silencieusement
 * au défaut `true` — un push en clair sur l'écran de veille d'un utilisateur
 * qui a explicitement demandé l'inverse. Absent → défaut DB (`true`). Un
 * re-subscribe sur un endpoint existant ne le réécrit jamais (cf.
 * `subscribeUser`).
 */
export const PushSubscribeBodySchema = z.object({
  endpoint: PushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  previewEnabled: z.boolean().optional(),
});
export type PushSubscribeBody = z.infer<typeof PushSubscribeBodySchema>;

/**
 * Body de `DELETE /push/subscribe` — identifie l'abonnement à retirer.
 *
 * Volontairement moins strict que `PushEndpointSchema` (pas de contrainte
 * https/hôte) : la suppression ne déclenche aucune requête sortante, et durcir
 * ce côté-là empêcherait de nettoyer une ligne devenue non conforme après un
 * durcissement des règles. La sécurité ici, c'est le filtre par `userId`
 * dans `unsubscribeUser`.
 */
export const PushUnsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBodySchema>;

/**
 * Body de `PATCH /push/subscribe` — met à jour le réglage "Aperçu" d'une
 * souscription existante (par device, cf. MAN-145 phase 4).
 *
 * Réutilise `PushEndpointSchema` (et non le schéma relâché de
 * `PushUnsubscribeBodySchema`) : contrairement à la suppression, on ne veut
 * pas ouvrir cette route à un endpoint non conforme — ce n'est pas un
 * chemin de nettoyage.
 */
export const PushUpdatePreviewBodySchema = z.object({
  endpoint: PushEndpointSchema,
  previewEnabled: z.boolean(),
});
export type PushUpdatePreviewBody = z.infer<typeof PushUpdatePreviewBodySchema>;

/** Reply commune de subscribe/unsubscribe — pas de détail exposé (anti-leak). */
export const PushOkReplySchema = z.object({
  ok: z.literal(true),
});

/** Reply de `GET /push/vapid-public-key`. */
export const VapidPublicKeyReplySchema = z.object({
  publicKey: z.string().min(1),
});
