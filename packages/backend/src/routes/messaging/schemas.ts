import { z } from 'zod';

import { ProviderTypeSchema } from '@nexus/shared';

/**
 * Schémas Zod pour les endpoints `/api/v1/me/messaging/*`.
 *
 * Depuis M1 (post-ADR-027) : sessions scopées USER (pas GROUP). Les
 * schémas n'incluent plus `groupId`.
 */

// ----- Atomes ----------------------------------------------------------------

export const SessionStatusSchema = z.enum(['connecting', 'connected', 'disconnected', 'error']);

// ----- DTOs ------------------------------------------------------------------

export const ProviderSessionDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  providerType: ProviderTypeSchema,
  externalId: z.string(),
  displayName: z.string(),
  status: SessionStatusSchema,
  statusDetail: z.string().nullable(),
  lastConnectedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ----- Params ----------------------------------------------------------------

export const SessionIdParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

// ----- Bodies / replies ------------------------------------------------------

export const ListSessionsReplySchema = z.object({
  sessions: z.array(ProviderSessionDtoSchema),
});

export const DeleteSessionReplySchema = z.object({
  ok: z.literal(true),
});

// ----- Webview-encapsulated providers (cf. ADR-022 + ADR-025 + ADR-027) -----
// Tous les providers messageries supportés sont webview-encapsulés. La
// session ne porte pas de credentials côté Nexus : l'auth se fait dans la
// webview Tauri (QR code WA/Telegram, login OAuth pour Discord/Slack/Teams,
// etc.). Backend stocke juste une "déclaration d'usage".
export const ConnectWebviewBodySchema = z.object({
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
});

/**
 * Libellé human-readable utilisé comme `displayName` à la création d'une
 * session webview. Source unique de vérité côté backend pour ne pas
 * recopier ces strings dans chaque route.
 */
export const WEBVIEW_PROVIDER_LABELS: Record<
  z.infer<typeof ConnectWebviewBodySchema>['providerType'],
  string
> = {
  discord: 'Discord',
  whatsapp: 'WhatsApp Web',
  messenger: 'Messenger',
  telegram: 'Telegram',
  instagram: 'Instagram',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  linkedin: 'LinkedIn',
  twitter: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
};

export const ConnectWebviewReplySchema = z.object({
  session: ProviderSessionDtoSchema,
});

// Polish P4 (révision) : le reorder est purement client-side (localStorage).
// Pas de schemas backend nécessaires — cf. AppShell.tsx.
