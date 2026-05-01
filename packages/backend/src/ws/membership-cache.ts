import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { groupMembers } from '../db/schema/index.js';

/**
 * Cache mémoire `groupId → list of userIds` pour le broadcast WS (J3c).
 *
 * TTL 5 min. Pas de mécanisme d'invalidation explicite côté DB pour V1 :
 * un nouvel ajout/retrait de membre prendra effet sous 5 min max. Pour
 * V2 on ajoutera une invalidation pub/sub Redis sur les events
 * member:added/removed (cf. J5+).
 *
 * Pas Redis pour V1 — le cache est par-process, ce qui suffit tant qu'on
 * a un seul backend HTTP. Dès qu'on scalera horizontalement, on
 * remplacera l'implémentation par un cache Redis sans changer l'API.
 */

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  members: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Renvoie la liste des userIds membres d'un groupe.
 * Cache hit : O(1). Cache miss : 1 query DB.
 */
export async function getGroupMembers(groupId: string): Promise<string[]> {
  const cached = cache.get(groupId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.members;
  }

  const db = getDb();
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const members = rows.map((r) => r.userId);

  cache.set(groupId, { members, expiresAt: Date.now() + TTL_MS });
  return members;
}

/**
 * Invalidation manuelle (pour tests ou pour anticipation d'un member:added/removed).
 */
export function invalidateGroup(groupId: string): void {
  cache.delete(groupId);
}

/**
 * Reset complet — utilisé uniquement par les tests.
 */
export function resetMembershipCache(): void {
  cache.clear();
}

/**
 * Pour debug / metrics : taille actuelle du cache.
 */
export function getMembershipCacheSize(): number {
  return cache.size;
}
