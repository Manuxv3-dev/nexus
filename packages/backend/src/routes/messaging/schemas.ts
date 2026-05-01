import { z } from 'zod';

import { ProviderTypeSchema } from '@nexus/shared';

/**
 * Schémas Zod pour les endpoints `/api/v1/groups/:groupId/messaging/*` et
 * `/api/v1/messaging/discord/oauth/callback`.
 */

// ----- Atomes ----------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  'connecting',
  'connected',
  'disconnected',
  'error',
]);

// ----- DTOs ------------------------------------------------------------------

export const ProviderSessionDtoSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  providerType: ProviderTypeSchema,
  externalId: z.string(),
  displayName: z.string(),
  hasCredentials: z.boolean(),
  status: SessionStatusSchema,
  statusDetail: z.string().nullable(),
  lastConnectedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MessagingMessageDtoSchema = z.object({
  // Pas d'UUID Nexus persistant pour les messages en V1 (lecture live via
  // RPC vers le worker provider). On utilise donc l'externalMessageId
  // comme `id` côté DTO — string libre, snowflake Discord ou JID WhatsApp.
  // À reconsidérer en V2 si on persiste les messages en DB (cf. backlog J5).
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
  // `.datetime()` strict refuserait un format légèrement non-canonique
  // (ex. timezone offset au lieu de Z). Discord renvoie de l'ISO standard,
  // mais pour rester tolérant on accepte n'importe quelle string ISO.
  externalCreatedAt: z.string(),
  externalEditedAt: z.string().nullable(),
});

export const MessagingChannelDtoSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  externalChannelId: z.string(),
  name: z.string(),
  channelType: z.enum(['text', 'dm', 'group_dm']),
  isArchived: z.boolean(),
});

// ----- Params ----------------------------------------------------------------

export const GroupIdParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export const SessionParamsSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

export const ChannelParamsSchema = z.object({
  groupId: z.string().uuid(),
  channelId: z.string().uuid(),
});

/**
 * Params pour les routes scopées à `:channelId` côté provider externe.
 * `:channelId` ici est l'externalChannelId (snowflake Discord, JID WhatsApp,
 * etc.) — donc une string libre, PAS un UUID Nexus.
 *
 * Utilisé pour : GET/POST .../channels/:channelId/messages
 */
export const ChannelMessagesParamsSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(),
  channelId: z.string().min(1),
});

// ----- Bodies / replies ------------------------------------------------------

export const ListSessionsReplySchema = z.object({
  sessions: z.array(ProviderSessionDtoSchema),
});

export const DeleteSessionReplySchema = z.object({
  ok: z.literal(true),
});

// Discord OAuth
export const InstallUrlReplySchema = z.object({
  installUrl: z.string().url(),
});

export const OauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  guild_id: z.string().optional(),
});

export const OauthCallbackReplySchema = z.object({
  ok: z.literal(true),
  redirectUrl: z.string().url(),
});

// Channels / messages
export const ListChannelsReplySchema = z.object({
  channels: z.array(MessagingChannelDtoSchema),
});

export const ListMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const ListMessagesReplySchema = z.object({
  messages: z.array(MessagingMessageDtoSchema),
  nextCursor: z.string().nullable(),
});

export const SendMessageBodySchema = z.object({
  content: z.string().min(1).max(4000),
  replyToExternalId: z.string().optional(),
});

export const SendMessageReplySchema = z.object({
  externalMessageId: z.string(),
  sentAt: z.string(),
});
