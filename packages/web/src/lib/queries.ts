/**
 * Hooks TanStack Query Nexus — un endpoint = un hook.
 *
 * Les schémas Zod restent au plus proche du backend (cf. packages/backend/src/routes).
 * En vrai monorepo on les exporterait depuis @nexus/shared, à faire en J4b-bis.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from './api';
import { useAuth } from './auth';

// ───────────────────────────── Groups ─────────────────────────────

/**
 * Schéma miroir de `GroupDtoSchema` côté backend (cf.
 * packages/backend/src/routes/groups/schemas.ts → GroupDtoSchema).
 *
 * Ne pas inventer de champs : on aligne strictement sur ce que renvoie
 * `groupToDto`. À terme (J4b-bis), ces schémas vivront dans `@nexus/shared`
 * pour ne plus avoir à les redéfinir des deux côtés.
 */
const GroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});
export type Group = z.infer<typeof GroupSchema>;

const GroupListReply = z.object({ groups: z.array(GroupSchema) });

export function useGroups() {
  // Gate sur l'auth : on attend la fin de `init()` ET la présence d'un user
  // avant de fetcher. Sinon, sur cold load d'une page publique (`/e/:slug`),
  // on partait avec un access token null → 401 silencieux → pas de refetch
  // automatique quand l'auth se complète, donc `isMember` restait toujours
  // false. La queryKey inclut l'`userId` pour invalider proprement quand on
  // change d'utilisateur (logout/relogin).
  const userId = useAuth((s) => s.user?.id);
  const initializing = useAuth((s) => s.initializing);
  return useQuery({
    enabled: !!userId && !initializing,
    queryKey: ['groups', userId ?? null],
    queryFn: async () =>
      api({ method: 'GET', path: '/groups', reply: GroupListReply }).then((r) => r.groups),
  });
}

const GroupMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['owner', 'admin', 'member']),
  joinedAt: z.string(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;
const GroupMembersReply = z.object({ members: z.array(GroupMemberSchema) });

export function useGroupMembers(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['group-members', groupId],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/members`,
        reply: GroupMembersReply,
      }).then((r) => r.members),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const reply = await api({
        method: 'POST',
        path: '/groups',
        body: input,
        reply: z.object({ group: GroupSchema }),
      });
      return reply.group;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      return api({
        method: 'POST',
        path: `/invitations/${slug}/accept`,
        body: {},
        reply: z.object({ group: GroupSchema }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

const InvitationSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  slug: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InvitationDto = z.infer<typeof InvitationSchema>;

export interface CreateInvitationInput {
  groupId: string;
  role?: 'owner' | 'admin' | 'member';
  maxUses?: number | null;
  ttlMs?: number;
}

/**
 * Réservé aux admin+ du groupe (vérifié côté backend). Crée une invitation
 * et renvoie le DTO complet — le lien à partager est
 * `${origin}/invite/${invitation.slug}`.
 */
export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvitationInput) => {
      const { groupId, ...body } = input;
      const reply = await api({
        method: 'POST',
        path: `/groups/${groupId}/invitations`,
        body,
        reply: z.object({ invitation: InvitationSchema }),
      });
      return reply.invitation;
    },
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ['invitations', inv.groupId] });
    },
  });
}

/**
 * Owner-only : supprime un groupe entier (cascade côté backend sur
 * group_members, invitations, messaging_sessions, etc.).
 */
export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      await api({ method: 'DELETE', path: `/groups/${groupId}` });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

/**
 * Self-leave : tout membre non-owner peut quitter le groupe. L'owner doit
 * d'abord transférer la propriété ou supprimer le groupe.
 */
export function useLeaveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      await api({ method: 'DELETE', path: `/groups/${groupId}/members/${userId}` });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

// ─────────────────────────── Messaging ────────────────────────────

/**
 * Schéma miroir du DTO `ProviderSessionView` côté backend (cf.
 * packages/backend/src/integrations/core/session-store.ts → sessionToView).
 *
 * IMPORTANT : `status` matche `provider_session_status` Postgres :
 *   connecting | connected | disconnected | error
 *
 * Ne pas inventer d'autres valeurs — un mismatch Zod fait échouer la
 * validation de la réponse et la liste apparaît vide côté UI sans
 * message d'erreur visible (cf. dette tracée dans backlog J4b-bis).
 */
const MessagingSessionStatusSchema = z.enum([
  'connecting',
  'connected',
  'disconnected',
  'error',
]);
export type MessagingSessionStatus = z.infer<typeof MessagingSessionStatusSchema>;

const MessagingSessionSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  providerType: z.enum(['discord', 'whatsapp', 'messenger']),
  externalId: z.string(),
  displayName: z.string(),
  hasCredentials: z.boolean(),
  status: MessagingSessionStatusSchema,
  statusDetail: z.string().nullable(),
  lastConnectedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessagingSession = z.infer<typeof MessagingSessionSchema>;
const MessagingSessionsReply = z.object({ sessions: z.array(MessagingSessionSchema) });

export function useMessagingSessions(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['messaging-sessions', groupId],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/messaging/sessions`,
        reply: MessagingSessionsReply,
      }).then((r) => r.sessions),
  });
}

/**
 * Récupère en parallèle les sessions de plusieurs groupes.
 *
 * Utilisé par le rail des groupes pour afficher une pastille indiquant
 * qu'une messagerie est branchée. À terme (J4b-bis), on remplacera ça
 * par un endpoint enrichi `GET /groups?withSessions=true` qui renverrait
 * les groupes + un résumé des sessions en une seule requête.
 *
 * Renvoie un Map<groupId, MessagingSession[]>. Chaque groupe est une
 * query indépendante qui partage la même clé que `useMessagingSessions`,
 * donc le cache est mutualisé : pas de fetch en double.
 */
export function useMessagingSessionsByGroup(
  groupIds: string[],
): Map<string, MessagingSession[]> {
  const queries = useQueries({
    queries: groupIds.map((id) => ({
      queryKey: ['messaging-sessions', id],
      queryFn: async () =>
        api({
          method: 'GET' as const,
          path: `/groups/${id}/messaging/sessions`,
          reply: MessagingSessionsReply,
        }).then((r) => r.sessions),
    })),
  });
  const out = new Map<string, MessagingSession[]>();
  groupIds.forEach((id, i) => {
    const q = queries[i];
    if (q && q.data) out.set(id, q.data);
  });
  return out;
}

/**
 * Schéma miroir du DTO `MessagingChannelDtoSchema` côté backend
 * (cf. routes/messaging/schemas.ts).
 */
const MessagingChannelSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  externalChannelId: z.string(),
  name: z.string(),
  channelType: z.enum(['text', 'dm', 'group_dm']),
  isArchived: z.boolean(),
  unread: z.number().int().optional(),
});
export type MessagingChannel = z.infer<typeof MessagingChannelSchema>;
const ChannelsReply = z.object({ channels: z.array(MessagingChannelSchema) });

/**
 * Supprime une session messagerie (le bot Discord reste dans le serveur,
 * il faut le retirer manuellement côté Discord — cf. ADR-009).
 *
 * Invalide les caches `messaging-sessions` et `channels` du groupe pour
 * que l'UI repasse à "Non connecté" sans refresh.
 */
export function useDeleteMessagingSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, sessionId }: { groupId: string; sessionId: string }) => {
      await api({
        method: 'DELETE',
        path: `/groups/${groupId}/messaging/sessions/${sessionId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['messaging-sessions', vars.groupId] });
      void qc.invalidateQueries({ queryKey: ['channels', vars.groupId] });
    },
  });
}

/**
 * Récupère l'URL d'invitation Discord (admin seulement).
 *
 * On expose une mutation plutôt qu'une query parce qu'on ne veut pas
 * pré-fetcher la URL : elle est générée à la demande, juste avant
 * d'ouvrir la fenêtre OAuth.
 */
export function useDiscordInstallUrl() {
  return useMutation({
    mutationFn: async (groupId: string) => {
      const reply = await api({
        method: 'GET',
        path: `/groups/${groupId}/messaging/discord/install-url`,
        reply: z.object({ installUrl: z.string().url() }),
      });
      return reply.installUrl;
    },
  });
}

export function useChannels(groupId: string | undefined, sessionId: string | undefined) {
  return useQuery({
    enabled: !!groupId && !!sessionId,
    queryKey: ['channels', groupId, sessionId],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/messaging/sessions/${sessionId!}/channels`,
        reply: ChannelsReply,
      }).then((r) => r.channels),
  });
}

/**
 * Schéma miroir de `MessagingMessageDtoSchema` côté backend.
 * Cf. routes/messaging/schemas.ts.
 */
const MessageSchema = z.object({
  id: z.string(),
  externalMessageId: z.string(),
  externalAuthorId: z.string(),
  authorDisplayName: z.string(),
  authorAvatarUrl: z.string().nullable(),
  content: z.string(),
  replyToExternalId: z.string().nullable(),
  attachments: z.unknown().nullable(),
  reactions: z.unknown().nullable(),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
  externalCreatedAt: z.string(),
  externalEditedAt: z.string().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;
const MessagesReply = z.object({
  messages: z.array(MessageSchema),
  nextCursor: z.string().nullable().optional(),
});

export function useMessages(
  groupId: string | undefined,
  sessionId: string | undefined,
  channelId: string | undefined,
) {
  return useQuery({
    enabled: !!groupId && !!sessionId && !!channelId,
    queryKey: ['messages', groupId, sessionId, channelId],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/messaging/sessions/${sessionId!}/channels/${channelId!}/messages`,
        reply: MessagesReply,
      }).then((r) => r.messages),
  });
}

export function useSendMessage(
  groupId: string | undefined,
  sessionId: string | undefined,
  channelId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) =>
      api({
        method: 'POST',
        path: `/groups/${groupId!}/messaging/sessions/${sessionId!}/channels/${channelId!}/messages`,
        body: { content: text },
        reply: z.object({ externalMessageId: z.string(), sentAt: z.string() }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', groupId, sessionId, channelId] }),
  });
}

// ─────────────────── Events (J5b #38 — branche DB) ───────────────────
//
// Schéma miroir du DTO backend (cf. packages/backend/src/routes/events/
// schemas.ts → EventDtoSchema). À déplacer en @nexus/shared en J4b-bis.

const RsvpValueSchema = z.enum(['yes', 'maybe', 'no']);
export type RsvpValue = z.infer<typeof RsvpValueSchema>;

const EventRsvpSchema = z.object({
  userId: z.string().uuid(),
  value: RsvpValueSchema,
});

const EventSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  location: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rsvps: z.array(EventRsvpSchema),
});
export type EventDto = z.infer<typeof EventSchema>;

const EventListReply = z.object({ events: z.array(EventSchema) });
const EventReply = z.object({ event: EventSchema });

export interface ListEventsFilter {
  when?: 'upcoming' | 'past' | 'all';
  channelId?: string;
}

export function useEvents(
  groupId: string | undefined,
  filter: ListEventsFilter = {},
) {
  const params = new URLSearchParams();
  if (filter.when) params.set('when', filter.when);
  if (filter.channelId) params.set('channelId', filter.channelId);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['events', groupId, filter],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/events${qs ? `?${qs}` : ''}`,
        reply: EventListReply,
      }).then((r) => r.events),
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ['event', eventId],
    queryFn: () =>
      api({ method: 'GET', path: `/events/${eventId!}`, reply: EventReply }).then(
        (r) => r.event,
      ),
  });
}

export interface CreateEventInput {
  groupId: string;
  channelId?: string | null;
  tags?: string[];
  title: string;
  description?: string | null;
  startsAt: string; // ISO
  location?: string | null;
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEventInput) => {
      const { groupId, ...body } = input;
      const reply = await api({
        method: 'POST',
        path: `/groups/${groupId}/events`,
        body,
        reply: EventReply,
      });
      return reply.event;
    },
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
    },
  });
}

export interface UpdateEventInput {
  eventId: string;
  channelId?: string | null;
  tags?: string[];
  title?: string;
  description?: string | null;
  startsAt?: string;
  location?: string | null;
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateEventInput) => {
      const { eventId, ...body } = input;
      const reply = await api({
        method: 'PATCH',
        path: `/events/${eventId}`,
        body,
        reply: EventReply,
      });
      return reply.event;
    },
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
      void qc.invalidateQueries({ queryKey: ['event', event.id] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId }: { eventId: string; groupId: string }) => {
      await api({
        method: 'DELETE',
        path: `/events/${eventId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['events', vars.groupId] });
      void qc.removeQueries({ queryKey: ['event', vars.eventId] });
    },
  });
}

export function useEventRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; value: RsvpValue | null }) => {
      const reply = await api({
        method: 'POST',
        path: `/events/${input.eventId}/rsvp`,
        body: { value: input.value },
        reply: EventReply,
      });
      return reply.event;
    },
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
      void qc.invalidateQueries({ queryKey: ['event', event.id] });
      // Page publique du même slug ouverte par le même user dans un autre
      // onglet → on rafraîchit aussi (le WS le fera de toute façon, mais
      // ça évite un flash dans le tab d'origine).
      void qc.invalidateQueries({ queryKey: ['public-event', event.slug] });
    },
  });
}

// ─────────────────── Polls (J5b #39 — branche DB) ────────────────────

const PollOptionSchema = z.object({
  id: z.string().uuid(),
  pollId: z.string().uuid(),
  label: z.string(),
  position: z.number().int(),
  voters: z.array(z.string().uuid()),
});

const PollSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().nullable(),
  options: z.array(PollOptionSchema),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PollDto = z.infer<typeof PollSchema>;

const PollListReply = z.object({ polls: z.array(PollSchema) });
const PollReply = z.object({ poll: PollSchema });

export interface ListPollsFilter {
  state?: 'open' | 'closed' | 'all';
  channelId?: string;
}

export function usePolls(
  groupId: string | undefined,
  filter: ListPollsFilter = {},
) {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  if (filter.channelId) params.set('channelId', filter.channelId);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['polls', groupId, filter],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/groups/${groupId!}/polls${qs ? `?${qs}` : ''}`,
        reply: PollListReply,
      }).then((r) => r.polls),
  });
}

export interface CreatePollInput {
  groupId: string;
  question: string;
  options: string[];
  multi?: boolean;
  closesAt?: string | null;
  tags?: string[];
  channelId?: string | null;
}

export function useCreatePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePollInput) => {
      const { groupId, ...body } = input;
      const reply = await api({
        method: 'POST',
        path: `/groups/${groupId}/polls`,
        body,
        reply: PollReply,
      });
      return reply.poll;
    },
    onSuccess: (poll) => {
      void qc.invalidateQueries({ queryKey: ['polls', poll.groupId] });
    },
  });
}

export function useDeletePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pollId }: { pollId: string; groupId: string }) => {
      await api({
        method: 'DELETE',
        path: `/polls/${pollId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['polls', vars.groupId] });
    },
  });
}

export function useVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pollId: string; optionId: string; value: boolean }) => {
      const reply = await api({
        method: 'POST',
        path: `/polls/${input.pollId}/vote`,
        body: { optionId: input.optionId, value: input.value },
        reply: PollReply,
      });
      return reply.poll;
    },
    onSuccess: (poll) => {
      void qc.invalidateQueries({ queryKey: ['polls', poll.groupId] });
      void qc.invalidateQueries({ queryKey: ['public-poll', poll.slug] });
    },
  });
}

// ───────────────────────────── Expenses ─────────────────────────────
//
// Aligné sur `packages/backend/src/routes/expenses/schemas.ts → ExpenseDtoSchema`
// (J5b #40). Les balances ne sont PAS renvoyées par le backend : on les
// calcule côté front depuis la liste des expenses (pas de besoin
// d'invalidation séparée → recalcul gratuit à chaque mutation).

const ExpenseShareSchema = z.object({
  expenseId: z.string().uuid(),
  userId: z.string().uuid(),
  shareCents: z.number().int().nonnegative(),
  isSettled: z.boolean(),
  settledAt: z.string().nullable(),
});
export type ExpenseShareDto = z.infer<typeof ExpenseShareSchema>;

const ExpenseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  description: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidBy: z.string().uuid(),
  settledAt: z.string().nullable(),
  shares: z.array(ExpenseShareSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseDto = z.infer<typeof ExpenseSchema>;

const ExpenseListReply = z.object({ expenses: z.array(ExpenseSchema) });
const ExpenseReply = z.object({ expense: ExpenseSchema });

export function useExpenses(
  groupId: string | undefined,
  filter?: { state?: 'open' | 'settled' | 'all'; channelId?: string },
) {
  const params = new URLSearchParams();
  if (filter?.state) params.set('state', filter.state);
  if (filter?.channelId) params.set('channelId', filter.channelId);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['expenses', groupId, filter?.state ?? 'all', filter?.channelId ?? null],
    queryFn: async () => {
      const path = `/groups/${groupId!}/expenses${qs ? `?${qs}` : ''}`;
      const reply = await api({ method: 'GET', path, reply: ExpenseListReply });
      return reply.expenses;
    },
  });
}

export function useExpense(expenseId: string | undefined) {
  return useQuery({
    enabled: !!expenseId,
    queryKey: ['expense', expenseId],
    queryFn: async () =>
      api({ method: 'GET', path: `/expenses/${expenseId!}`, reply: ExpenseReply }).then(
        (r) => r.expense,
      ),
  });
}

export interface CreateExpenseInput {
  groupId: string;
  channelId?: string | null;
  tags?: string[];
  description: string;
  amountCents: number;
  currency?: string;
  paidBy: string;
  shares: { userId: string; shareCents: number }[];
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const { groupId, ...body } = input;
      const reply = await api({
        method: 'POST',
        path: `/groups/${groupId}/expenses`,
        body: { currency: 'EUR', ...body },
        reply: ExpenseReply,
      });
      return reply.expense;
    },
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['expenses', e.groupId] });
    },
  });
}

export interface UpdateExpenseInput {
  expenseId: string;
  channelId?: string | null;
  tags?: string[];
  description?: string;
  amountCents?: number;
  currency?: string;
  paidBy?: string;
  shares?: { userId: string; shareCents: number }[];
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExpenseInput) => {
      const { expenseId, ...body } = input;
      const reply = await api({
        method: 'PATCH',
        path: `/expenses/${expenseId}`,
        body,
        reply: ExpenseReply,
      });
      return reply.expense;
    },
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['expense', e.id] });
      void qc.invalidateQueries({ queryKey: ['expenses', e.groupId] });
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { expenseId: string; groupId: string }) => {
      await api({
        method: 'DELETE',
        path: `/expenses/${input.expenseId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
      return input;
    },
    onSuccess: (input) => {
      void qc.invalidateQueries({ queryKey: ['expenses', input.groupId] });
      void qc.invalidateQueries({ queryKey: ['expense', input.expenseId] });
    },
  });
}

/**
 * Marque (ou démarque) MA part d'une expense comme réglée.
 * `userId` n'est pas pris en paramètre côté API — c'est toujours l'user
 * authentifié. Le hook expose seulement `expenseId` + `settled`.
 */
export function useSettleExpenseShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { expenseId: string; settled: boolean }) => {
      const reply = await api({
        method: 'POST',
        path: `/expenses/${input.expenseId}/settle`,
        body: { settled: input.settled },
        reply: ExpenseReply,
      });
      return reply.expense;
    },
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['expense', e.id] });
      void qc.invalidateQueries({ queryKey: ['expenses', e.groupId] });
      // La page publique peut être ouverte côté user authentifié → on
      // invalide aussi le cache public (cf. useKillerFeaturesWs).
      void qc.invalidateQueries({ queryKey: ['public-expense'] });
    },
  });
}

/**
 * Calcule la balance nette de chaque user à partir d'une liste d'expenses.
 *  - balance > 0 → on lui doit (il a payé plus que sa part)
 *  - balance < 0 → il doit (il a moins payé que sa part)
 *
 * On ignore les shares déjà settled (l'argent a déjà été transféré). Le
 * payeur reste crédité du total (l'argent qu'il a sorti) tant que toutes
 * les shares ne sont pas settled.
 */
export function computeBalances(
  expenses: ExpenseDto[],
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const e of expenses) {
    if (e.settledAt) continue; // Expense entièrement réglée — neutralisée.
    // Le payeur a sorti `amountCents` mais a une part `myShare` (peut être 0).
    // On ne crédite que la portion encore due par les autres : la dette
    // restante = sum(shares non settled, sauf paidBy).
    let creditDuePayer = 0;
    for (const s of e.shares) {
      if (s.userId === e.paidBy) continue;
      if (s.isSettled) continue;
      creditDuePayer += s.shareCents;
      const cur = balances.get(s.userId) ?? 0;
      balances.set(s.userId, cur - s.shareCents);
    }
    if (creditDuePayer > 0) {
      const cur = balances.get(e.paidBy) ?? 0;
      balances.set(e.paidBy, cur + creditDuePayer);
    }
  }
  return balances;
}

// ───────────────────────────── Todos ─────────────────────────────────
//
// Aligné sur `packages/backend/src/routes/todos/schemas.ts` (J5b #41).

const TodoItemSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  done: z.boolean(),
  assigneeId: z.string().uuid().nullable(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoItemDto = z.infer<typeof TodoItemSchema>;

const TodoListSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  groupId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
  items: z.array(TodoItemSchema),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoListDto = z.infer<typeof TodoListSchema>;

const TodoListListReply = z.object({ todoLists: z.array(TodoListSchema) });
const TodoListReply = z.object({ todoList: TodoListSchema });
const TodoItemReply = z.object({ todoItem: TodoItemSchema });

export function useTodoLists(
  groupId: string | undefined,
  filter?: { channelId?: string },
) {
  const params = new URLSearchParams();
  if (filter?.channelId) params.set('channelId', filter.channelId);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['todos', groupId, filter?.channelId ?? null],
    queryFn: async () => {
      const path = `/groups/${groupId!}/todo-lists${qs ? `?${qs}` : ''}`;
      const reply = await api({ method: 'GET', path, reply: TodoListListReply });
      return reply.todoLists;
    },
  });
}

export function useTodoList(listId: string | undefined) {
  return useQuery({
    enabled: !!listId,
    queryKey: ['todo-list', listId],
    queryFn: async () =>
      api({ method: 'GET', path: `/todo-lists/${listId!}`, reply: TodoListReply }).then(
        (r) => r.todoList,
      ),
  });
}

export interface CreateTodoListInput {
  groupId: string;
  channelId?: string | null;
  tags?: string[];
  title: string;
  initialItems?: { text: string; assigneeId?: string | null }[];
}

export function useCreateTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTodoListInput) => {
      const { groupId, ...body } = input;
      const reply = await api({
        method: 'POST',
        path: `/groups/${groupId}/todo-lists`,
        body,
        reply: TodoListReply,
      });
      return reply.todoList;
    },
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['todos', l.groupId] });
    },
  });
}

export function useUpdateTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listId: string;
      title?: string;
      tags?: string[];
      channelId?: string | null;
    }) => {
      const { listId, ...body } = input;
      const reply = await api({
        method: 'PATCH',
        path: `/todo-lists/${listId}`,
        body,
        reply: TodoListReply,
      });
      return reply.todoList;
    },
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['todo-list', l.id] });
      void qc.invalidateQueries({ queryKey: ['todos', l.groupId] });
    },
  });
}

export function useDeleteTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listId: string; groupId: string }) => {
      await api({
        method: 'DELETE',
        path: `/todo-lists/${input.listId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
      return input;
    },
    onSuccess: (input) => {
      void qc.invalidateQueries({ queryKey: ['todos', input.groupId] });
      void qc.invalidateQueries({ queryKey: ['todo-list', input.listId] });
    },
  });
}

export function useAddTodoItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      listId: string;
      groupId: string;
      text: string;
      assigneeId?: string | null;
    }) => {
      const reply = await api({
        method: 'POST',
        path: `/todo-lists/${input.listId}/items`,
        body: { text: input.text, assigneeId: input.assigneeId ?? null },
        reply: TodoItemReply,
      });
      return { item: reply.todoItem, groupId: input.groupId };
    },
    onSuccess: ({ item, groupId }) => {
      void qc.invalidateQueries({ queryKey: ['todo-list', item.listId] });
      void qc.invalidateQueries({ queryKey: ['todos', groupId] });
      void qc.invalidateQueries({ queryKey: ['public-todo'] });
    },
  });
}

export function useUpdateTodoItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemId: string;
      listId: string;
      groupId: string;
      text?: string;
      done?: boolean;
      assigneeId?: string | null;
      position?: number;
    }) => {
      const { itemId, listId, groupId, ...body } = input;
      const reply = await api({
        method: 'PATCH',
        path: `/todo-items/${itemId}`,
        body,
        reply: TodoItemReply,
      });
      return { item: reply.todoItem, listId, groupId };
    },
    onSuccess: ({ listId, groupId }) => {
      void qc.invalidateQueries({ queryKey: ['todo-list', listId] });
      void qc.invalidateQueries({ queryKey: ['todos', groupId] });
      void qc.invalidateQueries({ queryKey: ['public-todo'] });
    },
  });
}

export function useDeleteTodoItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; listId: string; groupId: string }) => {
      await api({
        method: 'DELETE',
        path: `/todo-items/${input.itemId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
      return input;
    },
    onSuccess: (input) => {
      void qc.invalidateQueries({ queryKey: ['todo-list', input.listId] });
      void qc.invalidateQueries({ queryKey: ['todos', input.groupId] });
      void qc.invalidateQueries({ queryKey: ['public-todo'] });
    },
  });
}

// ─────────────────────────── Notifications (cf. ADR-023) ────────────────

const NotificationKindEnum = z.enum([
  'event_reminder',
  'event_rsvp_requested',
  'event_rsvp_received',
  'expense_added',
  'todo_assigned',
  'todo_completed',
]);
export type NotificationKind = z.infer<typeof NotificationKindEnum>;

const NotificationSchema = z.object({
  id: z.string().uuid(),
  kind: NotificationKindEnum,
  payload: z.record(z.string(), z.unknown()),
  groupId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof NotificationSchema>;

const NotificationListReply = z.object({
  notifications: z.array(NotificationSchema),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

const MarkReadReply = z.object({
  ok: z.literal(true),
  markedCount: z.number().int().nonnegative(),
});

/**
 * Liste paginée des notifs du user courant. Fetch tout (50 par page) au
 * premier chargement ; la pagination cursor sera utilisée si on ajoute
 * scroll infini en V2.
 */
export function useNotifications(opts: { unread?: boolean; limit?: number } = {}) {
  const { unread, limit = 50 } = opts;
  const params = new URLSearchParams();
  if (unread) params.set('unread', 'true');
  if (limit) params.set('limit', String(limit));
  const queryString = params.toString();
  return useQuery({
    queryKey: ['notifications', { unread: !!unread, limit }],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/notifications${queryString ? '?' + queryString : ''}`,
        reply: NotificationListReply,
      }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { notificationId: string }) =>
      api({
        method: 'POST',
        path: `/notifications/${input.notificationId}/read`,
        body: {},
        reply: MarkReadReply,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      api({
        method: 'POST',
        path: `/notifications/read-all`,
        body: {},
        reply: MarkReadReply,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

const ClearAllReply = z.object({
  ok: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
});

/**
 * Vide la liste : supprime TOUTES les notifs (read + unread) du user.
 * Action utilisateur explicite, irréversible. Les events/expenses/todos
 * sous-jacents restent en place — seul l'historique de notifs disparaît.
 */
export function useClearAllNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      api({
        method: 'DELETE',
        path: `/notifications`,
        reply: ClearAllReply,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}


// ───────────────────────────── Home feed (cf. ADR-024) ──────────────────────

const HomePendingRsvp = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
const HomeUnsettledExpense = z.object({
  id: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int().nonnegative(),
  shareCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidById: z.string().uuid(),
  paidByName: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
const HomeAssignedTodo = z.object({
  id: z.string().uuid(),
  text: z.string(),
  listId: z.string().uuid(),
  listTitle: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
const HomeUpcomingEvent = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  location: z.string().nullable(),
  groupId: z.string().uuid(),
  groupName: z.string(),
});
const HomeGroupUnreadCount = z.object({
  groupId: z.string().uuid(),
  groupName: z.string(),
  count: z.number().int().nonnegative(),
});
const HomeFeedReply = z.object({
  pendingRsvps: HomePendingRsvp.array(),
  unsettledExpenses: HomeUnsettledExpense.array(),
  assignedTodos: HomeAssignedTodo.array(),
  upcomingEvents: HomeUpcomingEvent.array(),
  unreadByGroup: HomeGroupUnreadCount.array(),
});
export type HomeFeed = z.infer<typeof HomeFeedReply>;
export type HomePendingRsvpItem = z.infer<typeof HomePendingRsvp>;
export type HomeUnsettledExpenseItem = z.infer<typeof HomeUnsettledExpense>;
export type HomeAssignedTodoItem = z.infer<typeof HomeAssignedTodo>;
export type HomeUpcomingEventItem = z.infer<typeof HomeUpcomingEvent>;
export type HomeGroupUnreadItem = z.infer<typeof HomeGroupUnreadCount>;

/**
 * Récupère le feed agrégé Home (cf. ADR-024).
 *
 * Volume cible : top 5/10 par section, donc payload < 5 KB → on peut
 * polling agressivement (refetchOnWindowFocus + interval 60 s) sans soucis
 * de bande passante. Les notifs WS invalident déjà les caches concernés,
 * mais comme la Home agrège plusieurs sources, on garde un refetch périodique.
 */
export function useHomeFeed(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['home', 'feed'],
    queryFn: async () =>
      api({ method: 'GET', path: '/home/feed', reply: HomeFeedReply }),
    enabled: opts.enabled ?? true,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}
