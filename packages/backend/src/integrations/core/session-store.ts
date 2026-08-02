import type { ProviderStatus } from '@nexus/shared';
import { and, desc, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { getDb } from '../../db/client.js';
import {
  type MessagingProviderSession,
  type ProviderSessionStatusDb,
  type ProviderTypeDb,
  messagingProviderSessions,
} from '../../db/schema/index.js';

/**
 * Service CRUD pour les sessions de provider messagerie.
 *
 * Depuis M1 (post-ADR-027) : sessions scopées USER (pas GROUP). Un user a
 * son compte WhatsApp / Discord / etc. INDÉPENDAMMENT des groupes nexus
 * auxquels il appartient.
 *
 * Depuis migration 0011 : la colonne `encrypted_credentials` a été drop —
 * toutes les sessions sont webview-encapsulées Tauri sans credentials côté
 * serveur. Les fonctions `getCredentials` / `setCredentials` ont été
 * retirées (cf. historique git si besoin de réintroduire un mécanisme
 * de credentials côté serveur dans le futur).
 *
 * Anti-leak : la contrainte unique `(provider_type, external_id)` au niveau
 * DB garantit qu'un compte externe (Discord guild, WhatsApp account) ne
 * peut être rattaché qu'à un seul user nexus.
 */

// ----- DTO -------------------------------------------------------------------

export interface ProviderSessionView {
  id: string;
  userId: string;
  providerType: ProviderTypeDb;
  externalId: string;
  displayName: string;
  status: ProviderSessionStatusDb;
  statusDetail: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function sessionToView(s: MessagingProviderSession): ProviderSessionView {
  return {
    id: s.id,
    userId: s.userId,
    providerType: s.providerType,
    externalId: s.externalId,
    displayName: s.displayName,
    status: s.status,
    statusDetail: s.statusDetail,
    lastConnectedAt: s.lastConnectedAt?.toISOString() ?? null,
    lastError: s.lastError,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ----- Création --------------------------------------------------------------

export interface CreateSessionInput {
  userId: string;
  providerType: ProviderTypeDb;
  externalId: string;
  displayName: string;
  createdBy: string;
}

/**
 * Crée une nouvelle session messagerie. Throw RESOURCE_CONFLICT si une
 * session existe déjà pour ce `(providerType, externalId)`.
 */
export async function createSession(input: CreateSessionInput): Promise<MessagingProviderSession> {
  const db = getDb();

  try {
    const [created] = await db
      .insert(messagingProviderSessions)
      .values({
        userId: input.userId,
        providerType: input.providerType,
        externalId: input.externalId,
        displayName: input.displayName,
        createdBy: input.createdBy,
      })
      .returning();
    if (!created) throw new AppError('INTERNAL_ERROR');
    return created;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/messaging_sessions_provider_external_idx|unique/i.test(msg)) {
      throw new AppError('RESOURCE_CONFLICT', {
        reason: 'session_already_exists',
        providerType: input.providerType,
        externalId: input.externalId,
      });
    }
    throw err;
  }
}

// ----- Lecture ---------------------------------------------------------------

export async function findSession(id: string): Promise<MessagingProviderSession | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messagingProviderSessions)
    .where(eq(messagingProviderSessions.id, id))
    .limit(1);
  return rows[0];
}

export async function findSessionByExternal(
  providerType: ProviderTypeDb,
  externalId: string,
): Promise<MessagingProviderSession | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messagingProviderSessions)
    .where(
      and(
        eq(messagingProviderSessions.providerType, providerType),
        eq(messagingProviderSessions.externalId, externalId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Anti-leak : on filtre par userId. Utilisé par les routes API qui
 * doivent vérifier l'ownership avant d'exposer la session (ex : DELETE).
 */
export async function findSessionForUser(
  userId: string,
  sessionId: string,
): Promise<MessagingProviderSession | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messagingProviderSessions)
    .where(
      and(
        eq(messagingProviderSessions.id, sessionId),
        eq(messagingProviderSessions.userId, userId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listSessionsForUser(userId: string): Promise<MessagingProviderSession[]> {
  const db = getDb();
  // Tri serveur = createdAt desc. Le reorder user-defined est purement
  // client-side (localStorage, cf. P4 polish post-ADR-027).
  return db
    .select()
    .from(messagingProviderSessions)
    .where(eq(messagingProviderSessions.userId, userId))
    .orderBy(desc(messagingProviderSessions.createdAt));
}

/**
 * Liste toutes les sessions actives, optionnellement filtrées par provider.
 * Utilisé par les workers au boot pour reprendre les sessions.
 */
export async function listAllSessions(
  providerType?: ProviderTypeDb,
): Promise<MessagingProviderSession[]> {
  const db = getDb();
  if (providerType) {
    return db
      .select()
      .from(messagingProviderSessions)
      .where(eq(messagingProviderSessions.providerType, providerType));
  }
  return db.select().from(messagingProviderSessions);
}

// ----- Status ---------------------------------------------------------------

/**
 * Met à jour le statut runtime d'une session. Appelé par les workers
 * quand l'état de connexion change.
 *
 * Le `ProviderStatus` (typed union de @nexus/shared) est aplati vers les
 * colonnes DB `status` + `status_detail` + `last_connected_at` + `last_error`.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: ProviderStatus,
): Promise<void> {
  const db = getDb();
  const update: Partial<typeof messagingProviderSessions.$inferInsert> = {
    status: status.kind,
    updatedAt: new Date(),
  };

  switch (status.kind) {
    case 'connecting':
      update.statusDetail = null;
      update.lastError = null;
      break;
    case 'connected':
      update.statusDetail = null;
      update.lastError = null;
      update.lastConnectedAt = new Date(status.since);
      break;
    case 'disconnected':
      update.statusDetail = status.reason;
      update.lastError = null;
      break;
    case 'error':
      update.statusDetail = status.retryAt ?? null;
      update.lastError = status.error;
      break;
  }

  const result = await db
    .update(messagingProviderSessions)
    .set(update)
    .where(eq(messagingProviderSessions.id, sessionId))
    .returning({ id: messagingProviderSessions.id });

  if (result.length === 0) throw new AppError('RESOURCE_NOT_FOUND');
}

// ----- Suppression -----------------------------------------------------------

export async function deleteSession(sessionId: string): Promise<void> {
  const db = getDb();
  const result = await db
    .delete(messagingProviderSessions)
    .where(eq(messagingProviderSessions.id, sessionId))
    .returning({ id: messagingProviderSessions.id });
  if (result.length === 0) throw new AppError('RESOURCE_NOT_FOUND');
}
