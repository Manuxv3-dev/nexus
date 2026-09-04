/**
 * Schémas Zod pour la Home Nexus (cf. ADR-024).
 *
 * `GET /api/v1/home/feed` retourne un agrégat trans-groupes en une seule
 * requête. Les sections « top N » sont cap à un top N ; pas de pagination V1 —
 * le volume cible (top 5/10) couvre 99% des cas. On ajoutera si Manu reporte
 * un manque (paramètre limit avec borne sup, voire endpoint sectionné).
 *
 * `weekEvents` fait exception : c'est une section **bornée dans le temps**, pas
 * un top N. Elle alimente une grille Lundi → Dimanche, qui doit rendre tout ce
 * que la semaine porte — un top 5 y masquerait des jours en silence.
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

export const HomePendingPollDtoSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  /** Date de clôture (peut être null si sondage sans deadline). */
  closesAt: Iso.nullable(),
  /** Nombre d'options (info de contexte pour l'affichage). */
  optionCount: z.number().int().nonnegative(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
export type HomePendingPollDto = z.infer<typeof HomePendingPollDtoSchema>;

export const HomeGroupUnreadCountDtoSchema = z.object({
  groupId: z.string().uuid(),
  groupName: z.string(),
  /** Nombre de notifs unread liées à ce groupe (peut être 0 si tout lu). */
  count: z.number().int().nonnegative(),
});
export type HomeGroupUnreadCountDto = z.infer<typeof HomeGroupUnreadCountDtoSchema>;

/**
 * Un événement de la grille « cette semaine ».
 *
 * Même forme que `HomeUpcomingEventDto` — c'est la sémantique qui diffère,
 * pas les champs : `upcomingEvents` est un top 5 de MES events confirmés à
 * venir, `weekEvents` est TOUT ce que porte la semaine courante, RSVP ou pas,
 * passé compris. L'alias plutôt qu'un objet jumeau : deux définitions
 * identiques dériveraient à la première évolution de l'une.
 */
export const HomeWeekEventDtoSchema = HomeUpcomingEventDtoSchema;
export type HomeWeekEventDto = z.infer<typeof HomeWeekEventDtoSchema>;

export const HomeFeedReplySchema = z.object({
  pendingRsvps: HomePendingRsvpDtoSchema.array(),
  unsettledExpenses: HomeUnsettledExpenseDtoSchema.array(),
  assignedTodos: HomeAssignedTodoDtoSchema.array(),
  upcomingEvents: HomeUpcomingEventDtoSchema.array(),
  weekEvents: HomeWeekEventDtoSchema.array(),
  pendingPolls: HomePendingPollDtoSchema.array(),
  unreadByGroup: HomeGroupUnreadCountDtoSchema.array(),
});
export type HomeFeedReply = z.infer<typeof HomeFeedReplySchema>;

/**
 * Plafond de la fenêtre demandable. Une semaine en fait 7 ; la marge absorbe
 * les fuseaux et un éventuel appelant « ce mois-ci » sans ouvrir la porte à un
 * « toute l'année » qui scannerait la table events d'un groupe entier.
 */
const MAX_WEEK_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Query params de `GET /home/feed` — les bornes de la semaine à rendre.
 *
 * C'est le CLIENT qui définit « cette semaine » : `WeekCalendar` calcule sa
 * grille Lundi → Dimanche en heure locale du navigateur, et un serveur qui
 * recalculerait la sienne (UTC sur le VPS) divergerait aux bornes — un
 * événement du dimanche soir tomberait dans deux semaines différentes selon
 * qui compte.
 *
 * Les deux params restent **optionnels** : le desktop embarque une copie figée
 * de `@nexus/web` (`frontendDist`), donc les builds déjà installés appellent
 * cet endpoint sans eux. Les rendre obligatoires renverrait un 400 à leur Home
 * entière, pas seulement à son calendrier.
 *
 * Sans eux, `weekEvents` vaut `[]` : ces mêmes builds figés ne connaissent pas
 * le champ et le strippent au parse, donc calculer une semaine « au mieux »
 * côté serveur ne ferait qu'ajouter une requête SQL par poll dont le résultat
 * serait jeté. La fenêtre est opt-in — on la demande, ou on n'a rien.
 */
export const HomeFeedQuerySchema = z
  .object({
    weekStart: Iso.optional(),
    weekEnd: Iso.optional(),
  })
  .refine((q) => !q.weekStart === !q.weekEnd, {
    message: 'weekStart et weekEnd vont par paire',
  })
  .refine((q) => !q.weekStart || !q.weekEnd || Date.parse(q.weekEnd) > Date.parse(q.weekStart), {
    message: 'weekEnd doit être postérieur à weekStart',
  })
  .refine(
    (q) =>
      !q.weekStart ||
      !q.weekEnd ||
      Date.parse(q.weekEnd) - Date.parse(q.weekStart) <= MAX_WEEK_SPAN_MS,
    { message: 'la fenêtre demandée dépasse 31 jours' },
  );
export type HomeFeedQuery = z.infer<typeof HomeFeedQuerySchema>;

/** Limites de top N — alignées avec ADR-024. */
export const HOME_LIMITS = {
  pendingRsvps: 5,
  unsettledExpenses: 5,
  assignedTodos: 10,
  upcomingEvents: 5,
  pendingPolls: 5,
} as const;
