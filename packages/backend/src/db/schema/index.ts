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
    themePreference: text('theme_preference'),
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
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
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
// password_reset_tokens (cf. MAN-171, phase 1 de MAN-166 « mot de passe
// oublié — reset complet »)
// ----------------------------------------------------------------------------
//
// Jeton de reset de mot de passe : jamais stocké en clair, seulement son
// hash SHA-256 (`tokenHash`), comme `refresh_tokens`. `tokenHash` est UNIQUE
// pour permettre une recherche directe lors de la validation (`WHERE
// token_hash = ?`) et empêcher toute collision. `usedAt` NULL = jeton pas
// encore consommé ; posé à la première utilisation pour empêcher le replay.
// `expiresAt` porte la durée de vie courte du jeton (appliquée côté
// application, cf. phase 2). Cascade delete sur `userId` : si le user est
// supprimé, ses jetons de reset n'ont plus de sens.

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('password_reset_tokens_token_hash_idx').on(t.tokenHash),
    userIdx: index('password_reset_tokens_user_idx').on(t.userId),
  }),
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

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

export const rsvpValue = pgEnum('rsvp_value', ['yes', 'maybe', 'no']);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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

export const polls = pgTable(
  'polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    question: text('question').notNull(),
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
    pk: primaryKey({ columns: [t.pollId, t.optionId, t.userId] }),
    pollUserIdx: index('poll_votes_poll_user_idx').on(t.pollId, t.userId),
  }),
);

export type PollVote = typeof pollVotes.$inferSelect;
export type NewPollVote = typeof pollVotes.$inferInsert;

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    paidBy: uuid('paid_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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

export const todoLists = pgTable(
  'todo_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
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

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({
    userUnreadIdx: index('notifications_user_unread_idx').on(t.userId, t.readAt, t.createdAt),
    userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt),
    purgeIdx: index('notifications_purge_idx').on(t.createdAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ----------------------------------------------------------------------------
// user_notif_prefs (cf. ADR-034)
// ----------------------------------------------------------------------------
//
// Préférences de notification par user : un booléen par `kind` de notif
// (cf. NotificationKindSchema dans @nexus/shared). Toutes à TRUE par défaut
// (opt-out, pas opt-in). La ligne est créée paresseusement au premier GET
// /preferences si absente (cf. routes/notifications). L'enforcement se fait
// au choke point d'insertion (repo.insertNotification / insertNotificationsBulk) :
// un kind à FALSE => pas d'insert DB + pas de WS push pour ce user.
//
// 1 colonne par kind (pas de JSONB) pour bénéficier des NOT NULL DEFAULT et
// d'un filtrage SQL trivial côté enforcement. PK = user_id (1 ligne/user).

export const userNotifPrefs = pgTable('user_notif_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  eventReminder: boolean('event_reminder').notNull().default(true),
  eventRsvpRequested: boolean('event_rsvp_requested').notNull().default(true),
  eventRsvpReceived: boolean('event_rsvp_received').notNull().default(true),
  expenseAdded: boolean('expense_added').notNull().default(true),
  todoAssigned: boolean('todo_assigned').notNull().default(true),
  todoCompleted: boolean('todo_completed').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserNotifPrefs = typeof userNotifPrefs.$inferSelect;
export type NewUserNotifPrefs = typeof userNotifPrefs.$inferInsert;

// ----------------------------------------------------------------------------
// push_subscriptions (cf. MAN-142, phase 1 de MAN-24 « notifications push PWA »)
// ----------------------------------------------------------------------------
//
// Un abonnement Web Push par (user, device/navigateur) — un même user peut en
// avoir plusieurs (plusieurs appareils). `endpoint` identifie l'abonnement
// côté navigateur/push service et est UNIQUE : un re-subscribe sur le même
// endpoint doit remplacer les clés existantes, pas dupliquer la ligne
// (l'enforcement upsert vit dans le repo applicatif, pas dans le schema).
// `p256dh`/`auth` sont les clés de chiffrement fournies par la
// `PushSubscription` du navigateur, nécessaires pour chiffrer le payload
// envoyé via web-push. `previewEnabled` porte le toggle « Aperçu » de Settings
// (MAN-145) : à `false`, le push part avec un titre/corps générique — réglage
// par appareil, puisqu'une souscription = un navigateur.

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    previewEnabled: boolean('preview_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    endpointIdx: uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint),
    userIdx: index('push_subscriptions_user_idx').on(t.userId),
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

// ----------------------------------------------------------------------------
// activity_log (cf. ADR-029)
// ----------------------------------------------------------------------------
//
// Table append-only des actions importantes par groupe. Lue par
// `/api/v1/activity-feed` pour la timeline Home + GroupHome.
//
// Émission inline dans chaque route mutation (cf. helper recordActivity).
// `payload` est un snapshot dénormalisé pour permettre l'affichage sans
// JOIN au query time. `target_id` n'a PAS de FK : la cible peut être
// supprimée sans détruire l'entrée d'activité (l'historique est préservé
// via le snapshot dans `payload`).

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    targetId: uuid('target_id'),
    targetType: text('target_type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Timeline d'un groupe : filter group_id, sort created_at desc.
    groupCreatedIdx: index('activity_log_group_created_idx').on(t.groupId, t.createdAt),
    // BRIN pour le scroll cross-groupes (compact, suffisant pour les ranges).
    // Drizzle ne supporte pas BRIN nativement → cf. migration SQL 0013 pour la
    // création de cet index. Ce schema TS le commente pour info.
    // createdBrinIdx: BRIN sur createdAt (créé en migration 0013).
  }),
);

export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;

// ----------------------------------------------------------------------------
// waitlist (cf. MAN-21)
// ----------------------------------------------------------------------------
//
// Capture des emails de bêta depuis la landing. `email` est stocké déjà
// normalisé en minuscules par le handler (pas de réaffichage de la casse
// d'origine nécessaire, contrairement à `users`), mais l'unicité insensible
// à la casse est appliquée par un index d'expression `lower(email)` (comme
// `users`) plutôt qu'un index simple : l'invariant doit tenir même face à un
// futur écrivain qui contournerait la normalisation applicative (script de
// seed, import, accès direct).

export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailLowerIdx: uniqueIndex('waitlist_email_lower_idx').on(sql`lower(${t.email})`),
  }),
);

export type Waitlist = typeof waitlist.$inferSelect;
export type NewWaitlist = typeof waitlist.$inferInsert;
