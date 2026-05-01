import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Type bytea custom : Drizzle n'a pas de support natif clean pour les
 * colonnes BYTEA (Postgres binary), donc on en définit un. Utilisé par
 * `messaging_provider_sessions.encrypted_credentials`.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

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

export const providerType = pgEnum('provider_type', ['discord', 'whatsapp', 'messenger']);
export type ProviderTypeDb = (typeof providerType.enumValues)[number];

export const providerSessionStatus = pgEnum('provider_session_status', [
  'connecting',
  'connected',
  'disconnected',
  'error',
]);
export type ProviderSessionStatusDb = (typeof providerSessionStatus.enumValues)[number];

/**
 * Une session = un rattachement entre un groupe Nexus et un compte/serveur
 * externe. Pour Discord, c'est un guild. Pour WhatsApp, un compte. Pour
 * Messenger, un compte Meta.
 *
 * `encrypted_credentials` : creds chiffrés AES-256-GCM avec
 * ENCRYPTION_KEY_BRIDGES. NULL pour Discord (le bot token est global, pas
 * par-session). Format binaire `iv (12) || authTag (16) || ciphertext`.
 *
 * Anti-leak (cf. ADR-005) : `(provider_type, external_id)` unique → un
 * serveur Discord ne peut être rattaché qu'à un seul groupe Nexus.
 */
export const messagingProviderSessions = pgTable(
  'messaging_provider_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    providerType: providerType('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    encryptedCredentials: bytea('encrypted_credentials'),
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
    groupIdx: index('messaging_sessions_group_idx').on(t.groupId),
  }),
);

export type MessagingProviderSession = typeof messagingProviderSessions.$inferSelect;
export type NewMessagingProviderSession = typeof messagingProviderSessions.$inferInsert;

// ----------------------------------------------------------------------------
// messaging_channels
// ----------------------------------------------------------------------------

export const channelType = pgEnum('channel_type', ['text', 'dm', 'group_dm']);
export type ChannelTypeDb = (typeof channelType.enumValues)[number];

/**
 * Channels (textuels) découverts dans une session messagerie.
 * Mis à jour en sync par les workers bridges via events `channel:upsert`.
 */
export const messagingChannels = pgTable(
  'messaging_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => messagingProviderSessions.id, { onDelete: 'cascade' }),
    externalChannelId: text('external_channel_id').notNull(),
    name: text('name').notNull(),
    channelType: channelType('channel_type').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionExternalIdx: uniqueIndex('messaging_channels_session_external_idx').on(
      t.sessionId,
      t.externalChannelId,
    ),
    sessionIdx: index('messaging_channels_session_idx').on(t.sessionId),
  }),
);

export type MessagingChannel = typeof messagingChannels.$inferSelect;
export type NewMessagingChannel = typeof messagingChannels.$inferInsert;

// ----------------------------------------------------------------------------
// messaging_messages
// ----------------------------------------------------------------------------

/**
 * Cache local des messages synchronisés depuis les bridges. Permet la
 * pagination historique sans taper le provider externe à chaque coup,
 * et autorise un mode offline read en PWA.
 *
 * Dédup via `(channel_id, external_message_id)` unique : si un même
 * message arrive deux fois (ex. envoi via API + réception via gateway),
 * la seconde insertion est ignorée (`ON CONFLICT DO NOTHING`).
 */
export const messagingMessages = pgTable(
  'messaging_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => messagingChannels.id, { onDelete: 'cascade' }),
    externalMessageId: text('external_message_id').notNull(),
    externalAuthorId: text('external_author_id').notNull(),
    authorDisplayName: text('author_display_name').notNull(),
    authorAvatarUrl: text('author_avatar_url'),
    content: text('content').notNull(),
    replyToExternalId: text('reply_to_external_id'),
    attachments: jsonb('attachments'),
    reactions: jsonb('reactions'),
    isEdited: boolean('is_edited').notNull().default(false),
    isDeleted: boolean('is_deleted').notNull().default(false),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }).notNull(),
    externalEditedAt: timestamp('external_edited_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelExternalIdx: uniqueIndex('messaging_messages_channel_external_idx').on(
      t.channelId,
      t.externalMessageId,
    ),
    channelCreatedIdx: index('messaging_messages_channel_created_idx').on(
      t.channelId,
      t.externalCreatedAt,
    ),
  }),
);

export type MessagingMessage = typeof messagingMessages.$inferSelect;
export type NewMessagingMessage = typeof messagingMessages.$inferInsert;
