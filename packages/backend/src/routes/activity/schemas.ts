/**
 * Schémas Zod pour l'Activity Log (cf. ADR-029).
 *
 * `GET /api/v1/activity-feed?groupId=...&cursor=...&limit=...` retourne une
 * page de la timeline d'activité, filtrée par groupe (optionnel) ou
 * cross-groupes (sans filtre, contrainte par membership).
 *
 * Pagination cursor-based sur `created_at` (le cursor renvoyé est l'ISO
 * timestamp du dernier item — la page suivante demande les items strictement
 * plus anciens). Pas d'offset SQL pour éviter le drift en cas d'insertion
 * concurrente.
 */
import { z } from 'zod';

const Iso = z.string().datetime();

/**
 * Kinds d'activité supportés en V1. Ajout d'un kind = ajouter ici, dans le
 * type front (queries.ts) ET dans le mapping kind→texte du composant
 * `ActivityTimeline`. La liste évolue en mode "additif uniquement".
 */
export const ActivityKindSchema = z.enum([
  'event:created',
  'event:rsvp:changed',
  'event:cancelled',
  'poll:created',
  'poll:voted',
  'poll:closed',
  'expense:added',
  'expense:settled',
  'todo_list:created',
  'todo_item:checked',
  'todo_item:assigned',
  'member:joined',
  'member:left',
]);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/**
 * Type de la cible référencée par `target_id`. Utilisé côté front pour le
 * deep-link (ex : 'event' → naviguer vers la modal event).
 */
export const ActivityTargetTypeSchema = z.enum([
  'event',
  'poll',
  'expense',
  'todo_list',
  'todo_item',
  'member',
]);
export type ActivityTargetType = z.infer<typeof ActivityTargetTypeSchema>;

/**
 * Payload dénormalisé. Snapshot au moment de l'action (cf. ADR-029).
 * Tous les champs sont optionnels — chaque kind n'utilise que ce qui est
 * pertinent. La validation stricte est volontairement minimale ici, on
 * accepte un objet libre côté lecture pour ne pas péter si un nouveau
 * kind ajoute des champs avant que ce schema ne soit mis à jour.
 */
export const ActivityPayloadSchema = z
  .object({
    actorName: z.string().optional(),
    targetTitle: z.string().optional(),
    groupName: z.string().optional(),
    rsvp: z.string().optional(),
    amountCents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    optionLabel: z.string().optional(),
    itemText: z.string().optional(),
    assigneeName: z.string().optional(),
  })
  .catchall(z.unknown());
export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;

export const ActivityItemSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  actorId: z.string().uuid().nullable(),
  kind: ActivityKindSchema,
  targetId: z.string().uuid().nullable(),
  targetType: ActivityTargetTypeSchema,
  payload: ActivityPayloadSchema,
  createdAt: Iso,
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const ActivityFeedQuerySchema = z.object({
  /** Si présent, filtre par groupe (membership vérifié côté SQL). */
  groupId: z.string().uuid().optional(),
  /** Cursor ISO timestamp. Renvoie les items strictement plus anciens. */
  cursor: z.string().datetime().optional(),
  /** Limite d'items par page. Default 20, max 50. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ActivityFeedQuery = z.infer<typeof ActivityFeedQuerySchema>;

export const ActivityFeedReplySchema = z.object({
  items: ActivityItemSchema.array(),
  /** Cursor pour la page suivante. NULL = pas plus d'items. */
  nextCursor: z.string().datetime().nullable(),
});
export type ActivityFeedReply = z.infer<typeof ActivityFeedReplySchema>;

export const ACTIVITY_DEFAULT_LIMIT = 20;
