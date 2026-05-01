import { and, desc, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors.js';
import { getDb } from '../../db/client.js';
import {
  type MessagingProviderSession,
  type ProviderSessionStatusDb,
  type ProviderTypeDb,
  messagingProviderSessions,
} from '../../db/schema/index.js';

import { decryptJson, encryptJson } from './encryption.js';

import type { ProviderStatus } from '@nexus/shared';

/**
 * Service CRUD pour les sessions de provider messagerie (cf. ADR-009, J3a).
 *
 * Le chiffrement/déchiffrement des credentials est **transparent** : les
 * callers travaillent avec un objet TypeScript, le module gère le
 * round-trip chiffré pour l'écriture en BYTEA Postgres.
 *
 * Anti-leak : la contrainte unique `(provider_type, external_id)` au niveau
 * DB garantit qu'un même serveur Discord (ou compte WhatsApp) ne peut être
 * rattaché qu'à un seul groupe Nexus.
 */

// ----- DTO -------------------------------------------------------------------

export interface ProviderSessionView {
  id: string;
  groupId: string;
  providerType: ProviderTypeDb;
  externalId: string;
  displayName: string;
  /** Indique si des credentials chiffrés sont stockés (sans révéler leur contenu). */
  hasCredentials: boolean;
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
    groupId: s.groupId,
    providerType: s.providerType,
    externalId: s.externalId,
    displayName: s.displayName,
    hasCredentials: s.encryptedCredentials !== null,
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
  groupId: string;
  providerType: ProviderTypeDb;
  externalId: string;
  displayName: string;
  /** Optionnel — credentials initiaux (sera chiffré). */
  credentials?: Record<string, unknown>;
  createdBy: string;
}

/**
 * Crée une nouvelle session messagerie. Throw RESOURCE_CONFLICT si une
 * session existe déjà pour ce `(providerType, externalId)`.
 */
export async function createSession(input: CreateSessionInput): Promise<MessagingProviderSession> {
  const db = getDb();
  const encryptedCredentials = input.credentials
    ? encryptJson(input.credentials)
    : null;

  try {
    const [created] = await db
      .insert(messagingProviderSessions)
      .values({
        groupId: input.groupId,
        providerType: input.providerType,
        externalId: input.externalId,
        displayName: input.displayName,
        encryptedCredentials,
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
 * Anti-leak : on filtre par groupId. Utilisé par les routes API qui
 * doivent vérifier l'appartenance avant d'exposer.
 */
export async function findSessionInGroup(
  groupId: string,
  sessionId: string,
): Promise<MessagingProviderSession | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messagingProviderSessions)
    .where(
      and(
        eq(messagingProviderSessions.id, sessionId),
        eq(messagingProviderSessions.groupId, groupId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listSessionsForGroup(groupId: string): Promise<MessagingProviderSession[]> {
  const db = getDb();
  return db
    .select()
    .from(messagingProviderSessions)
    .where(eq(messagingProviderSessions.groupId, groupId))
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

// ----- Credentials chiffrés --------------------------------------------------

/**
 * Récupère les credentials déchiffrés d'une session. Renvoie `null` si
 * la session n'a pas de credentials stockés (ex. Discord bot global).
 *
 * Throw `RESOURCE_NOT_FOUND` si la session n'existe pas.
 */
export async function getCredentials<T extends Record<string, unknown>>(
  sessionId: string,
): Promise<T | null> {
  const session = await findSession(sessionId);
  if (!session) throw new AppError('RESOURCE_NOT_FOUND');
  if (!session.encryptedCredentials) return null;
  return decryptJson<T>(session.encryptedCredentials);
}

/**
 * Met à jour les credentials d'une session (chiffrement transparent).
 *
 * Throw `RESOURCE_NOT_FOUND` si la session n'existe pas.
 */
export async function setCredentials(
  sessionId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const encrypted = encryptJson(credentials);
  const result = await db
    .update(messagingProviderSessions)
    .set({ encryptedCredentials: encrypted, updatedAt: new Date() })
    .where(eq(messagingProviderSessions.id, sessionId))
    .returning({ id: messagingProviderSessions.id });
  if (result.length === 0) throw new AppError('RESOURCE_NOT_FOUND');
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
