import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Note : le customType `bytea` n'est plus utilisé depuis migration 0011
// (drop de `messaging_provider_sessions.encrypted_credentials`). Si une
// future feature demande à nouveau de stocker des bytes Postgres, le
// snippet d'origine est dans l'historique git (commit "drop bytea").

// ----------------------------------------------------------------------------
// users
// ----------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    /**
     * Préférence de thème UI synchronisée côté serveur (cf. J5b #50).
     * Validation enum 'dark' | 'light' | 'auto' faite côté API (Zod).
     * Nullable : un user qui n'a jamais touché au switcher → fallback front
     * (typiquement 'auto' qui suit prefers-color-scheme).
     */
    themePreference: text('theme_preference'),
    /**
     * Page d'atterrissage post-login (cf. ADR-024).
     * Valeurs validées Zod côté API :
     *   - 'home' (défaut) : Home Nexus, feed personnel trans-groupes
     *   - 'last_channel' : dernier canal/feature consulté (state localStorage côté front)
     *   - 'last_group_first_channel' : 1er channel du dernier groupe actif
     *   - 'last_group_first_feature' : ouvre directement la 1re feature (events) du dernier groupe
     * NOT NULL avec défaut 'home' pour que les users existants atterrissent
     * naturellement sur la nouvelle Home après migration.
     */
    landingPreference: text('landing_preference').notNull().default('home'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailLowerIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ----------------------------------------------------------------------------
// groups
// ----------------------------------------------------------------------------

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

// ----------------------------------------------------------------------------
// group_members
// ----------------------------------------------------------------------------

export const groupRole = pgEnum('group_role', ['owner', 'admin', 'member']);

export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueMembership: uniqueIndex('group_members_group_user_idx').on(t.groupId, t.userId),
    groupIdx: index('group_members_group_idx').on(t.groupId),
    userIdx: index('group_members_user_idx').on(t.userId),
  }),
);

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
export type GroupRole = (typeof groupRole.enumValues)[number];

// ----------------------------------------------------------------------------
// refresh_tokens (cf. ADR-004)
// ----------------------------------------------------------------------------

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    deviceId: text('device_id'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => refreshTokens.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('refresh_tokens_token_hash_idx').on(t.tokenHash),
    userIdx: index('refresh_tokens_user_idx').on(t.userId),
  }),
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

// ----------------------------------------------------------------------------
// group_invitations (cf. J2 — invitations par lien)
// ----------------------------------------------------------------------------

export const groupInvitations = pgTable(
  'group_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull().default('member'),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('group_invitations_slug_idx').on(t.slug),
    groupIdx: index('group_invitations_group_idx').on(t.groupId),
  }),
);

export type GroupInvitation = typeof groupInvitations.$inferSelect;
export type NewGroupInvitation = typeof groupInvitations.$inferInsert;

// ----------------------------------------------------------------------------
// messaging_provider_sessions (cf. ADR-009, J3a)
// ----------------------------------------------------------------------------

// ADR-027 : universalisation webview messaging — l'enum DB inclut désormais
// 9 providers supplémentaires (telegram → snapchat) en plus des 3 historiques.
// Aligné sur la migration 0007 et `@nexus/shared` ProviderTypeSchema.
export const providerType = pgEnum('provider_type', [
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
]);
export type ProviderTypeDb = (typeof providerType.enumValues)[number];

export const providerSessionStatus = pgEnum('provider_session_status', [
  'connecting',
  'connected',
  'disconnected',
  'error',
]);
export type ProviderSessionStatusDb = (typeof providerSessionStatus.enumValues)[number];

/**
 * Une session = un rattachement entre un USER nexus et un compte externe
 * (cf. M1 post-ADR-027). Pour Discord, c'est le compte Discord du user.
 * Pour WhatsApp, c'est SON compte WhatsApp. Indépendant des groupes nexus.
 *
 * `encrypted_credentials` (ex-colonne) : drop par migration 0011. Depuis
 * ADR-027 toutes les sessions sont webview-encapsulées côté Tauri, sans
 * credentials côté serveur — la colonne était orpheline.
 *
 * Anti-leak : `(provider_type, external_id)` unique — un compte Discord
 * externe ne peut être rattaché qu'à un seul user nexus. L'externalId pour
 * les webviews encode le userId : `webview:${userId}`.
 */
export const messagingProviderSessions = pgTable(
  'messaging_provider_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerType: providerType('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    status: providerSessionStatus('status').notNull().default('connecting'),
    statusDetail: text('status_detail'),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerExternalIdx: uniqueIndex('messaging_sessions_provider_external_idx').on(
      t.providerType,
      t.externalId,
    ),
    userIdx: index('messaging_sessions_user_idx').on(t.userId),
  }),
);

export type MessagingProviderSession = typeof messagingProviderSessions.$inferSelect;
export type NewMessagingProviderSession = typeof messagingProviderSessions.$inferInsert;

// ----------------------------------------------------------------------------
// (ex) messaging_channels + messaging_messages
// ----------------------------------------------------------------------------
//
// Tables supprimées par migration 0010 (cleanup post-ADR-027). Auparavant
// `messaging_channels` représentait les channels persistés découverts par
// les workers bridges, et `messaging_messages` le cache local des messages
// synchronisés. Depuis ADR-027 (universalisation webview), les conversations
// vivent dans des webviews encapsulées Tauri — Nexus ne touche plus le DOM
// des messages, et n'a plus besoin de persister channels ni messages.
//
// Les colonnes `channel_id` dans events/polls/expenses/todo_lists sont
// conservées en tant que `uuid` simple sans FK ni contrainte. Elles sont
// toujours NULL en pratique. Leur drop complet (ainsi que le cleanup du
// code routes / queries / front qui les manipule encore) est tracé comme
// dette technique pour une session de refactor dédiée
// (cf. .agent/backlog.md).

// ============================================================================
// Killer features — events / polls / expenses / todos (J5b #36)
// ============================================================================
//
// Convention partagée :
//   - id (uuid pk)
//   - slug (text unique, base62 12 chars — partage public)
//   - group_id (FK groups, cascade)
//   - channel_id (FK messaging_channels nullable — null = créé manuellement
//     hors d'un canal source, sinon le canal d'origine de l'intent)
//   - tags (text[] — libres pour V1, autocomplete intelligente plus tard)
//   - created_by (FK users, restrict — on garde l'historique même si le
//     créateur quitte)
//   - created_at / updated_at
//
// ----------------------------------------------------------------------------
// events + event_rsvps
// ----------------------------------------------------------------------------

export const rsvpValue = pgEnum('rsvp_value', ['yes', 'maybe', 'no']);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /**
     * (ex-FK) ID du channel d'origine de l'intent. Depuis ADR-027 + migration
     * 0010, la table `messaging_channels` n'existe plus et cette colonne est
     * NULL en pratique. Conservée en uuid simple sans contrainte le temps de
     * cleaner le code routes/queries qui la lit encore (cf. backlog).
     */
    channelId: uuid('channel_id'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    location: text('location'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('events_slug_idx').on(t.slug),
    groupIdx: index('events_group_idx').on(t.groupId),
    groupStartsAtIdx: index('events_group_starts_at_idx').on(t.groupId, t.startsAt),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: rsvpValue('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.userId] }),
  }),
);

export type EventRsvp = typeof eventRsvps.$inferSelect;
export type NewEventRsvp = typeof eventRsvps.$inferInsert;

// ----------------------------------------------------------------------------
// polls + poll_options + poll_votes
// ----------------------------------------------------------------------------

export const polls = pgTable(
  'polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /**
     * (ex-FK) ID du channel d'origine de l'intent. Depuis ADR-027 + migration
     * 0010, la table `messaging_channels` n'existe plus et cette colonne est
     * NULL en pratique. Conservée en uuid simple sans contrainte le temps de
     * cleaner le code routes/queries qui la lit encore (cf. backlog).
     */
    channelId: uuid('channel_id'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    question: text('question').notNull(),
    /** Si true, un user peut voter pour plusieurs options. */
    multi: boolean('multi').notNull().default(false),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('polls_slug_idx').on(t.slug),
    groupIdx: index('polls_group_idx').on(t.groupId),
  }),
);

export type Poll = typeof polls.$inferSelect;
export type NewPoll = typeof polls.$inferInsert;

export const pollOptions = pgTable(
  'poll_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** Ordre d'affichage stable (les options ne sont pas triées par created_at). */
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pollIdx: index('poll_options_poll_idx').on(t.pollId, t.position),
  }),
);

export type PollOption = typeof pollOptions.$inferSelect;
export type NewPollOption = typeof pollOptions.$inferInsert;

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Un user ne peut pas voter 2x pour la même option d'un même poll.
     * Pour les polls non-multi, la contrainte « 1 vote par user » est
     * gérée côté service (pas de partial unique en standard SQL).
     */
    pk: primaryKey({ columns: [t.pollId, t.optionId, t.userId] }),
    pollUserIdx: index('poll_votes_poll_user_idx').on(t.pollId, t.userId),
  }),
);

export type PollVote = typeof pollVotes.$inferSelect;
export type NewPollVote = typeof pollVotes.$inferInsert;

// ----------------------------------------------------------------------------
// expenses + expense_shares
// ----------------------------------------------------------------------------

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /**
     * (ex-FK) ID du channel d'origine de l'intent. Depuis ADR-027 + migration
     * 0010, la table `messaging_channels` n'existe plus et cette colonne est
     * NULL en pratique. Conservée en uuid simple sans contrainte le temps de
     * cleaner le code routes/queries qui la lit encore (cf. backlog).
     */
    channelId: uuid('channel_id'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    description: text('description').notNull(),
    /** Montant total en cents (entier, évite les flottants). */
    amountCents: integer('amount_cents').notNull(),
    /** ISO 4217 (3 chars : EUR, USD…). Validation côté service. */
    currency: text('currency').notNull(),
    paidBy: uuid('paid_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Marqué quand toutes les parts sont réglées (settled). */
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('expenses_slug_idx').on(t.slug),
    groupIdx: index('expenses_group_idx').on(t.groupId),
  }),
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export const expenseShares = pgTable(
  'expense_shares',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Part de cet user en cents. La somme des shares = amount_cents. */
    shareCents: integer('share_cents').notNull(),
    isSettled: boolean('is_settled').notNull().default(false),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.expenseId, t.userId] }),
  }),
);

export type ExpenseShare = typeof expenseShares.$inferSelect;
export type NewExpenseShare = typeof expenseShares.$inferInsert;

// ----------------------------------------------------------------------------
// todo_lists + todo_items
// ----------------------------------------------------------------------------

export const todoLists = pgTable(
  'todo_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /**
     * (ex-FK) ID du channel d'origine de l'intent. Depuis ADR-027 + migration
     * 0010, la table `messaging_channels` n'existe plus et cette colonne est
     * NULL en pratique. Conservée en uuid simple sans contrainte le temps de
     * cleaner le code routes/queries qui la lit encore (cf. backlog).
     */
    channelId: uuid('channel_id'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    title: text('title').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('todo_lists_slug_idx').on(t.slug),
    groupIdx: index('todo_lists_group_idx').on(t.groupId),
  }),
);

export type TodoList = typeof todoLists.$inferSelect;
export type NewTodoList = typeof todoLists.$inferInsert;

export const todoItems = pgTable(
  'todo_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => todoLists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    /** User assigné (optionnel). NULL = personne assigné. */
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Ordre d'affichage stable (drag-drop ready). */
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listIdx: index('todo_items_list_idx').on(t.listId, t.position),
  }),
);

export type TodoItem = typeof todoItems.$inferSelect;
export type NewTodoItem = typeof todoItems.$inferInsert;

// ============================================================================
// notifications — système transverse (cf. ADR-023, J5b #5/V1.2)
// ============================================================================
//
// Une notification = un événement métier persisté pour qu'un user puisse
// le retrouver en différé, en complément du toast WS éphémère qu'il aurait
// reçu s'il était online au moment du déclenchement.
//
// Convention :
//   - kind : string union TS (event_reminder | event_rsvp_requested |
//     expense_added | todo_assigned). Pas d'enum SQL pour souplesse —
//     ajouter un kind ne demande pas de migration.
//   - payload : JSONB libre, shape par kind documentée dans Zod côté
//     routes/notifications/schemas.ts.
//   - source_id : pointe vers la ressource source (event.id, expense.id,
//     todo_item.id). Pas de FK parce que la ressource peut être supprimée —
//     on garde la notif comme trace historique.
//   - group_id : utile pour deep-linking depuis la notif.
//   - read_at : NULL = unread, sinon timestamp de marquage.

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    /** ID de la ressource source (event, expense, todo_item, ...). Pas de FK
     *  parce que la ressource peut être supprimée. */
    sourceId: uuid('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL = unread. Timestamp = read. */
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({
    /** Lecture du panneau : unread d'abord (NULLS FIRST), puis par date desc. */
    userUnreadIdx: index('notifications_user_unread_idx').on(
      t.userId,
      t.readAt,
      t.createdAt,
    ),
    /** Pagination cursor par created_at desc. */
    userCreatedIdx: index('notifications_user_created_idx').on(
      t.userId,
      t.createdAt,
    ),
    /** Worker de purge nocturne : DELETE WHERE created_at < now() - interval '30 days'. */
    purgeIdx: index('notifications_purge_idx').on(t.createdAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
