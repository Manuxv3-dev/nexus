/**
 * Hooks TanStack Query Nexus — un endpoint = un hook.
 *
 * Les schémas Zod restent au plus proche du backend (cf. packages/backend/src/routes).
 * En vrai monorepo on les exporterait depuis @nexus/shared, à faire en J4b-bis.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from './api';
import { useAuth } from './auth';
import { destroyProviderWebview, providerWebviewLabel, type WebviewProvider } from './tauri';

/**
 * Les hooks ci-dessous gatent leur `queryFn` avec `enabled: !!id` — TanStack
 * Query ne l'exécute donc jamais avec un id manquant, mais le typage
 * `string | undefined` du paramètre ne le reflète pas côté `queryFn`. Ce
 * garde-fou explicite remplace l'assertion non-null `id!` par une erreur
 * lisible si ce contrat venait à être violé (plutôt qu'un `/x/undefined/y`).
 */
function requireId(id: string | undefined, label: string): string {
  if (!id) throw new Error(`${label} id is required`);
  return id;
}

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
        path: `/groups/${requireId(groupId, 'group')}/members`,
        reply: GroupMembersReply,
      }).then((r) => r.members),
  });
}

/**
 * Promeut/rétrograde un membre du groupe (MAN-180 Phase 1). Réservé aux
 * membres dont le rang est strictement supérieur à la cible côté backend
 * (`canManageRole` — 403 `PERMISSION_DENIED` sinon). Met à jour directement
 * le cache `['group-members', groupId]` avec le DTO renvoyé par la réponse
 * HTTP plutôt que d'attendre un refetch — le WS `member:role_updated`
 * (câblé dans `useKillerFeaturesWs`) réconcilie de toute façon les autres
 * onglets/utilisateurs.
 */
export function useUpdateGroupMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; userId: string; role: 'admin' | 'member' }) => {
      const reply = await api({
        method: 'PATCH',
        path: `/groups/${input.groupId}/members/${input.userId}/role`,
        body: { role: input.role },
        reply: z.object({ member: GroupMemberSchema }),
      });
      return reply.member;
    },
    onSuccess: (member, vars) => {
      qc.setQueryData<GroupMember[]>(['group-members', vars.groupId], (list) =>
        list ? list.map((m) => (m.userId === member.userId ? member : m)) : list,
      );
    },
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
const MessagingSessionStatusSchema = z.enum(['connecting', 'connected', 'disconnected', 'error']);
export type MessagingSessionStatus = z.infer<typeof MessagingSessionStatusSchema>;

const MessagingSessionSchema = z.object({
  id: z.string().uuid(),
  // M1 (post-ADR-027) : sessions scopées USER. Plus de groupId.
  userId: z.string().uuid(),
  // ADR-027 : universalisation webview messaging — l'enum DB inclut désormais
  // 9 providers supplémentaires (telegram → snapchat) en plus des 3 historiques.
  // Le frontend les surface tous en webview encapsulé (cf. PROVIDER_WEB_URL).
  providerType: z.enum([
    'discord',
    'whatsapp',
    'messenger',
    'telegram',
    'instagram',
    'slack',
    'teams',
    'linkedin',
    'twitter',
    'reddit',
    'tiktok',
    'snapchat',
  ]),
  externalId: z.string(),
  displayName: z.string(),
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

/**
 * Liste les sessions messagerie de l'utilisateur courant.
 *
 * Depuis M1 (post-ADR-027) : sessions scopées USER (pas GROUP). Un user a
 * son compte WhatsApp / Discord / etc. INDÉPENDAMMENT des groupes nexus
 * auxquels il appartient.
 */
export function useMessagingSessions() {
  return useQuery({
    queryKey: ['me-messaging-sessions'],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/me/messaging/sessions`,
        reply: MessagingSessionsReply,
      }).then((r) => r.sessions),
  });
}

/**
 * Supprime une session messagerie (la fenêtre webview Tauri reste ouverte
 * tant que l'user ne la ferme pas, mais la session DB est supprimée et
 * disparaîtra de la sidebar).
 *
 * Invalide le cache `messaging-sessions` du groupe pour que l'UI repasse
 * à "Non connecté" sans refresh.
 */
export function useDeleteMessagingSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
    }: {
      sessionId: string;
      // Polish P3 : passer le providerType permet le cleanup de la webview
      // Tauri persistante (cf. P3 backlog). Optionnel pour rester
      // backward-compat ; en mode web pur (non-Tauri), c'est un no-op.
      providerType?: WebviewProvider;
    }) => {
      await api({
        method: 'DELETE',
        path: `/me/messaging/sessions/${sessionId}`,
        reply: z.object({ ok: z.literal(true) }),
      });
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['me-messaging-sessions'] });
      // Polish P3 : detruit la webview Tauri persistante associée.
      if (vars.providerType) {
        const label = providerWebviewLabel(vars.providerType, vars.sessionId);
        void destroyProviderWebview(label).catch((err) => {
          console.warn('[delete-session] destroyProviderWebview failed', err);
        });
      }
    },
  });
}

// Polish P4 (révision) : le hook `useReorderMessagingSessions` a été retiré.
// L'ordre des sessions est purement client-side (par-user) via localStorage,
// géré directement dans `AppShell.tsx` (helpers `readSessionOrder` /
// `writeSessionOrder`). Pas de mutation API nécessaire.

/**
 * Connecte un provider messagerie en mode "webview encapsulée" (cf.
 * ADR-022/025/027). Depuis M1, scope USER : un user a son compte
 * WhatsApp / Discord / etc. INDÉPENDAMMENT des groupes.
 *
 * Pas de credentials transitant côté backend, pas d'OAuth flow. La route
 * POST crée juste une session "déclarative" qui permet au front d'afficher
 * le panneau webview correspondant. L'auth se fait dans la webview elle-même
 * (QR code WA, login Messenger, etc.).
 *
 * Idempotent côté backend : appeler 2x avec le même provider renvoie la
 * même session.
 */
export function useConnectWebviewProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerType,
    }: {
      // ADR-027 : 12 providers webview-encapsulés (Discord inclus).
      providerType:
        | 'discord'
        | 'whatsapp'
        | 'messenger'
        | 'telegram'
        | 'instagram'
        | 'slack'
        | 'teams'
        | 'linkedin'
        | 'twitter'
        | 'reddit'
        | 'tiktok'
        | 'snapchat';
    }) => {
      const reply = await api({
        method: 'POST',
        path: `/me/messaging/webview-sessions`,
        body: { providerType },
        reply: z.object({ session: MessagingSessionSchema }),
      });
      return reply.session;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me-messaging-sessions'] });
    },
  });
}

// ADR-027 : suppression des hooks `useDiscordInstallUrl`, `useChannels`,
// `useMessages`, `useSendMessage`. Toutes les messageries sont désormais
// webview-encapsulées (pas de channels Nexus, pas d'API messages serveur).

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
}

export function useEvents(groupId: string | undefined, filter: ListEventsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.when) params.set('when', filter.when);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['events', groupId, filter],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/groups/${requireId(groupId, 'group')}/events${qs ? `?${qs}` : ''}`,
        reply: EventListReply,
      }).then((r) => r.events),
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ['event', eventId],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/events/${requireId(eventId, 'event')}`,
        reply: EventReply,
      }).then((r) => r.event),
  });
}

export interface CreateEventInput {
  groupId: string;
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
    // ─── Optimistic update (cf. backlog J4b-bis) ───────────────────────
    // Le user clique sur Yes/Maybe/No → on patche immédiatement le cache
    // local pour que la donut RSVP, le badge "Mes réponses en attente"
    // et la card de l'event reflètent le choix instantanément. Si le
    // backend KO, onError rollback. onSettled refetch pour réconcilier.
    onMutate: async (input) => {
      const userId = useAuth.getState().user?.id;
      if (!userId) return { snapshots: [] };

      // Lire l'event en cache pour récupérer son groupId (besoin pour
      // cibler les queries `['events', groupId, filter]`).
      const eventKey = ['event', input.eventId] as const;
      const cachedEvent = qc.getQueryData<EventDto>(eventKey);
      const groupId = cachedEvent?.groupId;

      // Cancel les queries en vol pour ne pas écraser notre optimistic.
      await qc.cancelQueries({ queryKey: eventKey });
      if (groupId) {
        await qc.cancelQueries({ queryKey: ['events', groupId] });
      }
      if (cachedEvent?.slug) {
        await qc.cancelQueries({ queryKey: ['public-event', cachedEvent.slug] });
      }

      // Snapshot pour rollback.
      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      if (cachedEvent) snapshots.push({ key: [...eventKey], data: cachedEvent });
      if (groupId) {
        qc.getQueriesData<EventDto[]>({ queryKey: ['events', groupId] }).forEach(([k, d]) => {
          if (d) snapshots.push({ key: k, data: d });
        });
      }
      if (cachedEvent?.slug) {
        const publicKey = ['public-event', cachedEvent.slug] as const;
        const publicCached = qc.getQueryData<EventDto>(publicKey);
        if (publicCached) {
          snapshots.push({ key: [...publicKey], data: publicCached });
        }
      }

      // Patch helper : remplace le RSVP du user dans event.rsvps.
      const patchEvent = (e: EventDto): EventDto => {
        if (e.id !== input.eventId) return e;
        const without = e.rsvps.filter((r) => r.userId !== userId);
        const next = input.value ? [...without, { userId, value: input.value }] : without;
        return { ...e, rsvps: next };
      };

      if (cachedEvent) {
        qc.setQueryData<EventDto>(eventKey, patchEvent(cachedEvent));
      }
      if (groupId) {
        qc.setQueriesData<EventDto[]>({ queryKey: ['events', groupId] }, (list) =>
          list ? list.map(patchEvent) : list,
        );
      }
      if (cachedEvent?.slug) {
        qc.setQueriesData<EventDto>({ queryKey: ['public-event', cachedEvent.slug] }, (e) =>
          e ? patchEvent(e) : e,
        );
      }

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (event, _err, input) => {
      // Réconciliation : on refetch contre la source de vérité serveur.
      // Si la mutation a réussi, on a `event` ; sinon on tente d'invalider
      // depuis l'input (le minimum requis).
      const eventId = event?.id ?? input.eventId;
      void qc.invalidateQueries({ queryKey: ['event', eventId] });
      if (event) {
        void qc.invalidateQueries({ queryKey: ['events', event.groupId] });
        // Page publique du même slug ouverte par le même user dans un autre
        // onglet → on rafraîchit aussi (le WS le fera de toute façon, mais
        // ça évite un flash dans le tab d'origine).
        void qc.invalidateQueries({ queryKey: ['public-event', event.slug] });
      }
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
}

export function usePolls(groupId: string | undefined, filter: ListPollsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['polls', groupId, filter],
    queryFn: () =>
      api({
        method: 'GET',
        path: `/groups/${requireId(groupId, 'group')}/polls${qs ? `?${qs}` : ''}`,
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
    // ─── Optimistic update ───────────────────────────────────────────────
    // Toggle l'userId dans option.voters de l'option ciblée. Si poll.multi=
    // false, on retire le user des autres options (un seul vote).
    onMutate: async (input) => {
      const userId = useAuth.getState().user?.id;
      if (!userId) return { snapshots: [] };

      // Trouver le poll dans le cache pour récupérer groupId + multi + slug.
      const allPolls = qc.getQueriesData<PollDto[]>({ queryKey: ['polls'] });
      let target: PollDto | undefined;
      for (const [, list] of allPolls) {
        const found = list?.find((p) => p.id === input.pollId);
        if (found) {
          target = found;
          break;
        }
      }
      if (!target) return { snapshots: [] };

      const groupId = target.groupId;
      const slug = target.slug;
      const multi = target.multi;

      await qc.cancelQueries({ queryKey: ['polls', groupId] });
      if (slug) await qc.cancelQueries({ queryKey: ['public-poll', slug] });

      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      qc.getQueriesData<PollDto[]>({ queryKey: ['polls', groupId] }).forEach(([k, d]) => {
        if (d) snapshots.push({ key: k, data: d });
      });
      const publicCached = qc.getQueryData<PollDto>(['public-poll', slug]);
      if (publicCached) snapshots.push({ key: ['public-poll', slug], data: publicCached });

      const patchPoll = (p: PollDto): PollDto => {
        if (p.id !== input.pollId) return p;
        return {
          ...p,
          options: p.options.map((opt) => {
            if (opt.id === input.optionId) {
              const without = opt.voters.filter((v) => v !== userId);
              return {
                ...opt,
                voters: input.value ? [...without, userId] : without,
              };
            }
            // Single-choice : retirer le user des autres options s'il vient
            // d'ajouter une voix ailleurs.
            if (!multi && input.value) {
              return { ...opt, voters: opt.voters.filter((v) => v !== userId) };
            }
            return opt;
          }),
        };
      };

      qc.setQueriesData<PollDto[]>({ queryKey: ['polls', groupId] }, (list) =>
        list ? list.map(patchPoll) : list,
      );
      if (publicCached) {
        qc.setQueryData<PollDto>(['public-poll', slug], patchPoll(publicCached));
      }

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (poll, _err, input) => {
      if (poll) {
        void qc.invalidateQueries({ queryKey: ['polls', poll.groupId] });
        void qc.invalidateQueries({ queryKey: ['public-poll', poll.slug] });
      } else {
        // Best-effort si KO : tente d'invalider via tous les groupes en cache.
        void qc.invalidateQueries({ queryKey: ['polls'] });
        void qc.invalidateQueries({ queryKey: ['public-poll'] });
      }
      void input; // unused but kept for signature consistency
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
  filter?: { state?: 'open' | 'settled' | 'all' },
) {
  const params = new URLSearchParams();
  if (filter?.state) params.set('state', filter.state);
  const qs = params.toString();
  return useQuery({
    enabled: !!groupId,
    queryKey: ['expenses', groupId, filter?.state ?? 'all'],
    queryFn: async () => {
      const path = `/groups/${requireId(groupId, 'group')}/expenses${qs ? `?${qs}` : ''}`;
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
      api({
        method: 'GET',
        path: `/expenses/${requireId(expenseId, 'expense')}`,
        reply: ExpenseReply,
      }).then((r) => r.expense),
  });
}

export interface CreateExpenseInput {
  groupId: string;
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
    // ─── Optimistic update ───────────────────────────────────────────────
    // Toggle isSettled de la share du user courant. Met aussi à jour
    // `settledAt` pour cohérence visuelle (badge "Réglée le X").
    onMutate: async (input) => {
      const userId = useAuth.getState().user?.id;
      if (!userId) return { snapshots: [] };

      const expenseKey = ['expense', input.expenseId] as const;
      const cachedExpense = qc.getQueryData<ExpenseDto>(expenseKey);
      const groupId = cachedExpense?.groupId;

      await qc.cancelQueries({ queryKey: expenseKey });
      if (groupId) await qc.cancelQueries({ queryKey: ['expenses', groupId] });

      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      if (cachedExpense) snapshots.push({ key: [...expenseKey], data: cachedExpense });
      if (groupId) {
        qc.getQueriesData<ExpenseDto[]>({ queryKey: ['expenses', groupId] }).forEach(([k, d]) => {
          if (d) snapshots.push({ key: k, data: d });
        });
      }

      const nowIso = new Date().toISOString();
      const patchExpense = (e: ExpenseDto): ExpenseDto => {
        if (e.id !== input.expenseId) return e;
        return {
          ...e,
          shares: e.shares.map((s) =>
            s.userId === userId
              ? {
                  ...s,
                  isSettled: input.settled,
                  settledAt: input.settled ? nowIso : null,
                }
              : s,
          ),
        };
      };

      if (cachedExpense) {
        qc.setQueryData<ExpenseDto>(expenseKey, patchExpense(cachedExpense));
      }
      if (groupId) {
        qc.setQueriesData<ExpenseDto[]>({ queryKey: ['expenses', groupId] }, (list) =>
          list ? list.map(patchExpense) : list,
        );
      }

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (e, _err, input) => {
      const expenseId = e?.id ?? input.expenseId;
      void qc.invalidateQueries({ queryKey: ['expense', expenseId] });
      if (e) void qc.invalidateQueries({ queryKey: ['expenses', e.groupId] });
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
export function computeBalances(expenses: ExpenseDto[]): Map<string, number> {
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

export function useTodoLists(groupId: string | undefined) {
  return useQuery({
    enabled: !!groupId,
    queryKey: ['todos', groupId],
    queryFn: async () => {
      const reply = await api({
        method: 'GET',
        path: `/groups/${requireId(groupId, 'group')}/todo-lists`,
        reply: TodoListListReply,
      });
      return reply.todoLists;
    },
  });
}

export function useTodoList(listId: string | undefined) {
  return useQuery({
    enabled: !!listId,
    queryKey: ['todo-list', listId],
    queryFn: async () =>
      api({
        method: 'GET',
        path: `/todo-lists/${requireId(listId, 'todo list')}`,
        reply: TodoListReply,
      }).then((r) => r.todoList),
  });
}

export interface CreateTodoListInput {
  groupId: string;
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
    mutationFn: async (input: { listId: string; title?: string; tags?: string[] }) => {
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
    // ─── Optimistic update ───────────────────────────────────────────────
    // Critique pour le toggle done : cocher une case doit être instantané
    // sans flicker. On patche `text`, `done`, `assigneeId`, `position` au
    // passage (tout ce qui peut être passé en input).
    onMutate: async (input) => {
      const { itemId, listId, groupId, ...patch } = input;

      await qc.cancelQueries({ queryKey: ['todo-list', listId] });
      await qc.cancelQueries({ queryKey: ['todos', groupId] });

      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      const cachedList = qc.getQueryData<TodoListDto>(['todo-list', listId]);
      if (cachedList) snapshots.push({ key: ['todo-list', listId], data: cachedList });
      qc.getQueriesData<TodoListDto[]>({ queryKey: ['todos', groupId] }).forEach(([k, d]) => {
        if (d) snapshots.push({ key: k, data: d });
      });

      const patchItem = (i: TodoItemDto): TodoItemDto => {
        if (i.id !== itemId) return i;
        return {
          ...i,
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.done !== undefined ? { done: patch.done } : {}),
          ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
        };
      };
      const patchList = (l: TodoListDto): TodoListDto =>
        l.id === listId ? { ...l, items: l.items.map(patchItem) } : l;

      if (cachedList) qc.setQueryData<TodoListDto>(['todo-list', listId], patchList(cachedList));
      qc.setQueriesData<TodoListDto[]>({ queryKey: ['todos', groupId] }, (list) =>
        list ? list.map(patchList) : list,
      );

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (result, _err, input) => {
      const listId = result?.listId ?? input.listId;
      const groupId = result?.groupId ?? input.groupId;
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
    // ─── Optimistic update ───────────────────────────────────────────────
    // Suppression inline : l'item disparaît immédiatement de la liste.
    // En cas d'erreur backend, on le ré-injecte via le snapshot.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['todo-list', input.listId] });
      await qc.cancelQueries({ queryKey: ['todos', input.groupId] });

      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      const cachedList = qc.getQueryData<TodoListDto>(['todo-list', input.listId]);
      if (cachedList) snapshots.push({ key: ['todo-list', input.listId], data: cachedList });
      qc.getQueriesData<TodoListDto[]>({ queryKey: ['todos', input.groupId] }).forEach(([k, d]) => {
        if (d) snapshots.push({ key: k, data: d });
      });

      const removeItem = (l: TodoListDto): TodoListDto =>
        l.id === input.listId ? { ...l, items: l.items.filter((i) => i.id !== input.itemId) } : l;

      if (cachedList)
        qc.setQueryData<TodoListDto>(['todo-list', input.listId], removeItem(cachedList));
      qc.setQueriesData<TodoListDto[]>({ queryKey: ['todos', input.groupId] }, (list) =>
        list ? list.map(removeItem) : list,
      );

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: (_d, _err, input) => {
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
    // ─── Optimistic update ───────────────────────────────────────────────
    // Le user clique une notif → badge unread (cloche) doit baisser
    // instantanément. On patche TOUTES les variantes de query
    // `['notifications', ...]` (car la cloche utilise `useNotifications()`
    // sans filtre, mais le panel pourrait avoir des filtres différents).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });

      type NotifReply = z.infer<typeof NotificationListReply>;
      const snapshots: { key: readonly unknown[]; data: unknown }[] = [];
      qc.getQueriesData<NotifReply>({ queryKey: ['notifications'] }).forEach(([k, d]) => {
        if (d) snapshots.push({ key: k, data: d });
      });

      const nowIso = new Date().toISOString();
      qc.setQueriesData<NotifReply>({ queryKey: ['notifications'] }, (cur) => {
        if (!cur) return cur;
        let wasUnread = false;
        const notifications = cur.notifications.map((n) => {
          if (n.id !== input.notificationId) return n;
          if (n.readAt === null) wasUnread = true;
          return { ...n, readAt: n.readAt ?? nowIso };
        });
        return {
          ...cur,
          notifications,
          unreadCount: wasUnread ? Math.max(0, cur.unreadCount - 1) : cur.unreadCount,
        };
      });

      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
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
const HomePendingPoll = z.object({
  id: z.string().uuid(),
  question: z.string(),
  closesAt: z.string().nullable(),
  optionCount: z.number().int().nonnegative(),
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
  pendingPolls: HomePendingPoll.array(),
  unreadByGroup: HomeGroupUnreadCount.array(),
});
export type HomeFeed = z.infer<typeof HomeFeedReply>;
export type HomePendingRsvpItem = z.infer<typeof HomePendingRsvp>;
export type HomeUnsettledExpenseItem = z.infer<typeof HomeUnsettledExpense>;
export type HomeAssignedTodoItem = z.infer<typeof HomeAssignedTodo>;
export type HomeUpcomingEventItem = z.infer<typeof HomeUpcomingEvent>;
export type HomePendingPollItem = z.infer<typeof HomePendingPoll>;
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
    queryFn: async () => api({ method: 'GET', path: '/home/feed', reply: HomeFeedReply }),
    enabled: opts.enabled ?? true,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

// ───────────────────────────── Activity feed (cf. ADR-029) ──────────────────

const ActivityKindEnum = z.enum([
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
export type ActivityKind = z.infer<typeof ActivityKindEnum>;

const ActivityTargetTypeEnum = z.enum([
  'event',
  'poll',
  'expense',
  'todo_list',
  'todo_item',
  'member',
]);
export type ActivityTargetType = z.infer<typeof ActivityTargetTypeEnum>;

const ActivityPayload = z
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
export type ActivityPayloadDto = z.infer<typeof ActivityPayload>;

const ActivityItem = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  actorId: z.string().uuid().nullable(),
  kind: ActivityKindEnum,
  targetId: z.string().uuid().nullable(),
  targetType: ActivityTargetTypeEnum,
  payload: ActivityPayload,
  createdAt: z.string().datetime(),
});
export type ActivityItemDto = z.infer<typeof ActivityItem>;

const ActivityFeedReply = z.object({
  items: ActivityItem.array(),
  nextCursor: z.string().datetime().nullable(),
});
export type ActivityFeedPage = z.infer<typeof ActivityFeedReply>;

/**
 * Récupère le feed d'activité paginé (cf. ADR-029).
 *
 * Sans filtre : timeline cross-groupes (Home Nexus).
 * Avec `groupId` : timeline d'un groupe (GroupHomeDashboard).
 *
 * Pagination cursor-based : `fetchNextPage()` charge la page suivante,
 * `nextCursor === null` signifie "fin de l'historique".
 */
export function useActivityFeed(opts: { groupId?: string; enabled?: boolean } = {}) {
  const { groupId, enabled = true } = opts;
  return useInfiniteQuery({
    queryKey: ['activity-feed', groupId ?? 'all'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams();
      if (groupId) params.set('groupId', groupId);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api({
        method: 'GET',
        path: `/activity-feed${qs ? `?${qs}` : ''}`,
        reply: ActivityFeedReply,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

// ─────────────────────── Préférences de notification (ADR-034) ───────────────

/**
 * Miroir de `NotificationPrefsDtoSchema` côté backend
 * (routes/notifications/schemas.ts) : un booléen par `kind`. À terme via
 * @nexus/shared (dette J4b-bis).
 */
const NotificationPrefsSchema = z.object({
  eventReminder: z.boolean(),
  eventRsvpRequested: z.boolean(),
  eventRsvpReceived: z.boolean(),
  expenseAdded: z.boolean(),
  todoAssigned: z.boolean(),
  todoCompleted: z.boolean(),
  updatedAt: z.string(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
/** Clés togglables (sans `updatedAt`). */
export type NotificationPrefKey = Exclude<keyof NotificationPrefs, 'updatedAt'>;
const NotificationPrefsReply = z.object({ preferences: NotificationPrefsSchema });

export function useNotificationPrefs() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    enabled: !!userId,
    queryKey: ['notification-prefs', userId ?? null],
    queryFn: async () =>
      api({
        method: 'GET',
        path: '/notifications/preferences',
        reply: NotificationPrefsReply,
      }).then((r) => r.preferences),
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Record<NotificationPrefKey, boolean>>) =>
      api({
        method: 'PATCH',
        path: '/notifications/preferences',
        body: patch,
        reply: NotificationPrefsReply,
      }).then((r) => r.preferences),
    onSuccess: (prefs) => {
      const userId = useAuth.getState().user?.id ?? null;
      qc.setQueryData(['notification-prefs', userId], prefs);
    },
  });
}
