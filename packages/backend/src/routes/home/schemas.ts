/**
 * Schémas Zod pour la Home Nexus (cf. ADR-024).
 *
 * `GET /api/v1/home/feed` retourne un agrégat trans-groupes en une seule
 * requête : 5 sections, chacune cap à un top N. Pas de pagination V1 — le
 * volume cible (top 5/10) couvre 99% des cas. On ajoutera si Manu reporte
 * un manque (paramètre limit avec borne sup, voire endpoint sectionné).
 *
 * Convention : tous les `groupName` / `paidByName` / `listTitle` sont
 * dénormalisés ici → le front n'a pas à requeter chaque groupe pour
 * afficher la card. Les URLs/slugs restent à recalculer côté front (les
 * dashboards les ont déjà).
 */
import { z } from 'zod';

const Iso = z.string().datetime();

export const HomePendingRsvpDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: Iso,
  groupId: z.string().uuid(),
  groupName: z.string(),
});
export type HomePendingRsvpDto = z.infer<typeof HomePendingRsvpDtoSchema>;

export const HomeUnsettledExpenseDtoSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  /** Total expense en cents (info de contexte). */
  amountCents: z.number().int().nonnegative(),
  /** Ma part non réglée, en cents. C'est ce que JE dois. */
  shareCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidById: z.string().uuid(),
  paidByName: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
export type HomeUnsettledExpenseDto = z.infer<typeof HomeUnsettledExpenseDtoSchema>;

export const HomeAssignedTodoDtoSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  listId: z.string().uuid(),
  listTitle: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
export type HomeAssignedTodoDto = z.infer<typeof HomeAssignedTodoDtoSchema>;

export const HomeUpcomingEventDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: Iso,
  location: z.string().nullable(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
export type HomeUpcomingEventDto = z.infer<typeof HomeUpcomingEventDtoSchema>;

export const HomeGroupUnreadCountDtoSchema = z.object({
  groupId: z.string().uuid(),
  groupName: z.string(),
  /** Nombre de notifs unread liées à ce groupe (peut être 0 si tout lu). */
  count: z.number().int().nonnegative(),
});
export type HomeGroupUnreadCountDto = z.infer<typeof HomeGroupUnreadCountDtoSchema>;

export const HomeFeedReplySchema = z.object({
  pendingRsvps: HomePendingRsvpDtoSchema.array(),
  unsettledExpenses: HomeUnsettledExpenseDtoSchema.array(),
  assignedTodos: HomeAssignedTodoDtoSchema.array(),
  upcomingEvents: HomeUpcomingEventDtoSchema.array(),
  unreadByGroup: HomeGroupUnreadCountDtoSchema.array(),
});
export type HomeFeedReply = z.infer<typeof HomeFeedReplySchema>;

/** Limites de top N — alignées avec ADR-024. */
export const HOME_LIMITS = {
  pendingRsvps: 5,
  unsettledExpenses: 5,
  assignedTodos: 10,
  upcomingEvents: 5,
} as const;
