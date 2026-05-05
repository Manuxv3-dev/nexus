import { z } from 'zod';

/**
 * Interface `MessagingProvider` et types associés (cf. ADR-009).
 *
 * Chaque messagerie supportée (Discord, WhatsApp, Messenger…) expose une
 * implémentation de cette interface. Le backend Nexus s'adresse à elles
 * uniquement via ces contrats — aucun code applicatif ne dépend de
 * `discord.js`, `Baileys`, ou `mautrix-meta` directement.
 *
 * Les types ici sont portables entre backend et clients web (le client
 * web peut afficher un `ProviderMessage` sans dépendre des libs natives
 * messageries).
 *
 * Note : ce fichier ne contient que des **types et schémas Zod**. Les
 * implémentations concrètes (et leurs dépendances Node) vivent dans
 * `@nexus/backend/integrations/<provider>/`.
 */

// ----- Provider type ---------------------------------------------------------

/**
 * Liste des messageries supportées (cf. ADR-027).
 *
 * Depuis ADR-027 (universalisation webview messaging), TOUS les providers
 * sont traités de manière homogène : encapsulés dans une webview Tauri
 * côté desktop. Discord a quitté son statut "API native" pour rejoindre
 * WhatsApp/Messenger dans le pattern webview, et 9 nouveaux providers ont
 * été ajoutés (Telegram → Snapchat).
 *
 * Doit rester aligné avec :
 *   - DB enum `provider_type` (cf. migration 0007)
 *   - `BrandKey` côté @nexus/web (BrandIcon)
 *   - `WebviewProvider` côté @nexus/web (lib/tauri.ts)
 *   - `ConnectWebviewBodySchema` côté @nexus/backend (routes/messaging)
 */
export const ProviderTypeSchema = z.enum([
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
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// ----- Capabilities ----------------------------------------------------------

export const ProviderCapabilitiesSchema = z.object({
  sendMessage: z.boolean(),
  editMessage: z.boolean(),
  deleteMessage: z.boolean(),
  reactions: z.boolean(),
  attachments: z.boolean(),
  /** V2+ */
  voice: z.boolean(),
  /** V2+ */
  threads: z.boolean(),
  presence: z.boolean(),
  typingIndicator: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

// ----- Channel ---------------------------------------------------------------

export const ChannelTypeSchema = z.enum(['text', 'dm', 'group_dm']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ProviderChannelSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  channelType: ChannelTypeSchema,
  isArchived: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});
export type ProviderChannel = z.infer<typeof ProviderChannelSchema>;

// ----- Attachment ------------------------------------------------------------

export const AttachmentSchema = z.object({
  url: z.string().url(),
  type: z.string(), // 'image/png', 'application/pdf', etc.
  size: z.number().int().nonnegative().optional(),
  name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ----- Reaction --------------------------------------------------------------

export const ReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
  byMe: z.boolean(),
});
export type Reaction = z.infer<typeof ReactionSchema>;

// ----- Message ---------------------------------------------------------------

export const ProviderMessageSchema = z.object({
  externalId: z.string(),
  channelExternalId: z.string(),
  authorExternalId: z.string(),
  authorDisplayName: z.string(),
  authorAvatarUrl: z.string().url().nullable(),
  content: z.string(),
  replyToExternalId: z.string().nullable(),
  attachments: z.array(AttachmentSchema),
  reactions: z.array(ReactionSchema),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
  externalCreatedAt: z.string().datetime(),
  externalEditedAt: z.string().datetime().nullable(),
});
export type ProviderMessage = z.infer<typeof ProviderMessageSchema>;

// ----- Status ----------------------------------------------------------------

export const ProviderStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connecting') }),
  z.object({ kind: z.literal('connected'), since: z.string().datetime() }),
  z.object({
    kind: z.literal('disconnected'),
    reason: z.string(),
    lastConnectedAt: z.string().datetime().nullable(),
  }),
  z.object({
    kind: z.literal('error'),
    error: z.string(),
    retryAt: z.string().datetime().nullable(),
  }),
]);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

// ----- Send message ----------------------------------------------------------

export const SendMessageInputSchema = z.object({
  channelExternalId: z.string(),
  content: z.string().min(1).max(10_000),
  replyToExternalId: z.string().nullable().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const SendMessageResultSchema = z.object({
  externalMessageId: z.string(),
  sentAt: z.string().datetime(),
});
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

// ----- Fetch history ---------------------------------------------------------

export const FetchHistoryInputSchema = z.object({
  channelExternalId: z.string(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type FetchHistoryInput = z.infer<typeof FetchHistoryInputSchema>;

export const FetchHistoryResultSchema = z.object({
  messages: z.array(ProviderMessageSchema),
  nextCursor: z.string().nullable(),
});
export type FetchHistoryResult = z.infer<typeof FetchHistoryResultSchema>;

// ----- Provider interface ----------------------------------------------------

/**
 * Contrat que toute messagerie intégrée doit implémenter.
 *
 * Convention : les méthodes sont async, et throw `AppError` côté backend
 * en cas d'erreur structurelle (pas de capability, channel introuvable,
 * etc.). Le worker bridge convertit les erreurs réseau / rate-limit en
 * `ProviderStatus.kind === 'error'` et les remonte via le bus d'events.
 *
 * Les implémentations concrètes vivent dans
 * `@nexus/backend/integrations/<provider>/provider.ts`.
 */
export interface MessagingProvider {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  /**
   * Démarre la connexion (gateway WebSocket / polling / etc.).
   * Idempotent — si déjà connecté, no-op.
   */
  connect(): Promise<void>;

  /**
   * Coupe proprement (libère ressources).
   * Idempotent — si déjà déconnecté, no-op.
   */
  disconnect(): Promise<void>;

  /**
   * Envoie un message dans un channel externe.
   * Throw si capability `sendMessage` absente.
   */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /**
   * Récupère les messages d'un channel, paginé par cursor.
   * Le format du cursor est opaque — chaque provider gère son propre.
   */
  fetchHistory(input: FetchHistoryInput): Promise<FetchHistoryResult>;

  /**
   * Liste les channels accessibles à cette session.
   * Les channels sont agrégés côté Nexus dans `messaging_channels`.
   */
  listChannels(): Promise<ProviderChannel[]>;

  /**
   * Statut courant de la session.
   */
  getStatus(): ProviderStatus;
}
