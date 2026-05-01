/**
 * Hooks TanStack Query Nexus — un endpoint = un hook.
 *
 * Les schémas Zod restent au plus proche du backend (cf. packages/backend/src/routes).
 * En vrai monorepo on les exporterait depuis @nexus/shared, à faire en J4b-bis.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from './api';

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
  return useQuery({
    queryKey: ['groups'],
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
    },
  });
}

const PollSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  question: z.string(),
  multi: z.boolean(),
  closesAt: z.string().nullable(),
  options: z.array(
    z.object({ id: z.string(), label: z.string(), voters: z.array(z.string()) }),
  ),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type PollDto = z.infer<typeof PollSchema>;
const PollListReply = z.object({ polls: z.array(PollSchema) });

export function usePolls(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['polls', groupId],
    queryFn: async () =>
      api({ method: 'GET', path: `/groups/${groupId!}/polls`, reply: PollListReply })
        .then((r) => r.polls)
        .catch(() => [] as PollDto[]),
  });
}

const ExpenseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  description: z.string(),
  amountCents: z.number().int(),
  currency: z.string(),
  paidBy: z.string(),
  participants: z.array(z.string()),
  createdAt: z.string(),
});
export type ExpenseDto = z.infer<typeof ExpenseSchema>;
const ExpenseListReply = z.object({
  expenses: z.array(ExpenseSchema),
  balances: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        amountCents: z.number().int(),
      }),
    )
    .optional(),
});

export function useExpenses(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['expenses', groupId],
    queryFn: async () =>
      api({ method: 'GET', path: `/groups/${groupId!}/expenses`, reply: ExpenseListReply }).catch(
        () => ({ expenses: [] as ExpenseDto[], balances: [] as { from: string; to: string; amountCents: number }[] }),
      ),
  });
}

const TodoListSchema = z.object({
  id: z.string(),
  slug: z.string(),
  groupId: z.string(),
  title: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      done: z.boolean(),
      assigneeId: z.string().nullable(),
    }),
  ),
  createdAt: z.string(),
});
export type TodoListDto = z.infer<typeof TodoListSchema>;
const TodoListListReply = z.object({ lists: z.array(TodoListSchema) });

export function useTodoLists(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['todos', groupId],
    queryFn: async () =>
      api({ method: 'GET', path: `/groups/${groupId!}/todos`, reply: TodoListListReply })
        .then((r) => r.lists)
        .catch(() => [] as TodoListDto[]),
  });
}
