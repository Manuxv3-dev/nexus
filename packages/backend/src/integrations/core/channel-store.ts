/**
 * Store des channels messageries (table `messaging_channels`).
 *
 * Le worker `discord-bridge` (et bientôt `whatsapp-bridge`, `messenger-bridge`)
 * publie un event `channel:upsert` à chaque fois qu'il découvre un channel
 * texte sur la messagerie source. Le `bridge-relay` côté backend HTTP capture
 * ces events et appelle `upsertMessagingChannel` ci-dessous pour persister
 * en DB.
 *
 * L'API HTTP (`GET /channels`) lit ensuite cette table — sans avoir besoin
 * d'un client Discord/WhatsApp/Messenger côté process HTTP, ce qui serait
 * impossible avec l'architecture bridges server-side de l'ADR-009 (un seul
 * process worker = un seul client gateway par provider).
 */
import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import {
  messagingChannels,
  type ChannelTypeDb,
  type MessagingChannel,
} from '../../db/schema/index.js';

export interface UpsertChannelInput {
  sessionId: string;
  externalChannelId: string;
  name: string;
  channelType: ChannelTypeDb;
}

/**
 * Insert ou met à jour un channel pour une session donnée.
 *
 * Idempotent : la contrainte `messaging_channels_session_external_idx`
 * sur `(session_id, external_channel_id)` garantit qu'on ne crée pas de
 * doublon. Si la ligne existe, on met à jour `name`, `channel_type` et
 * `is_archived = false`, et on bump `updated_at`.
 */
export async function upsertMessagingChannel(input: UpsertChannelInput): Promise<void> {
  const db = getDb();
  await db
    .insert(messagingChannels)
    .values({
      sessionId: input.sessionId,
      externalChannelId: input.externalChannelId,
      name: input.name,
      channelType: input.channelType,
      isArchived: false,
    })
    .onConflictDoUpdate({
      target: [messagingChannels.sessionId, messagingChannels.externalChannelId],
      set: {
        name: input.name,
        channelType: input.channelType,
        isArchived: false,
        updatedAt: new Date(),
      },
    });
}

/**
 * Marque un channel comme archivé (équivalent soft-delete).
 *
 * Appelé quand le worker reçoit un `ChannelDelete` côté Discord. On ne
 * supprime pas la ligne pour préserver les références (messages déjà reçus,
 * historique, etc.) et pour refléter fidèlement le côté provider.
 */
export async function archiveMessagingChannel(
  sessionId: string,
  externalChannelId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(messagingChannels)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(
      and(
        eq(messagingChannels.sessionId, sessionId),
        eq(messagingChannels.externalChannelId, externalChannelId),
      ),
    );
}

/**
 * Liste les channels actifs (non archivés) d'une session.
 * Utilisé par l'API HTTP `GET /channels`.
 */
export async function listChannelsForSession(sessionId: string): Promise<MessagingChannel[]> {
  const db = getDb();
  return db
    .select()
    .from(messagingChannels)
    .where(
      and(
        eq(messagingChannels.sessionId, sessionId),
        eq(messagingChannels.isArchived, false),
      ),
    );
}
