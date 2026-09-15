/**
 * Le refus serveur « cette personne n'est pas membre du groupe » — et comment
 * le dire à l'écran (cf. ticket 77950250).
 *
 * Le backend le renvoie via `assertAllMembers` (`routes/groups/service.ts`)
 * chaque fois qu'on rattache quelqu'un à du contenu de groupe : payeur ou
 * parts d'une dépense, assigné d'un todo. Réponse `400 VALIDATION_ERROR`,
 * `details: { reason: 'user_not_member', userId }`. Le message backend est
 * « Validation error » — pas une phrase pour un écran.
 *
 * Le cas réel qui y mène : les selects sont alimentés par
 * `['group-members', groupId]`. Un membre part pendant que la modale est
 * ouverte, et entre le `member:removed` et le refetch — ou si le WS est
 * tombé — le formulaire propose encore quelqu'un que le serveur refuse.
 */
import { ApiError } from './api';

/** Message quand la liste des membres ne connaît plus la personne refusée. */
const GENERIC = 'Cette personne ne fait plus partie du groupe.';

/**
 * L'identifiant de la personne refusée si `err` est ce refus-là, sinon `null`.
 * Strict sur les trois champs : un autre `VALIDATION_ERROR`, ou le même
 * `reason` sous un autre code, ne doit pas déclencher le message ni le
 * refetch des membres.
 */
function refusedUserId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const details = err.details;
  if (typeof details !== 'object' || details === null) return null;
  const { reason, userId } = details as { reason?: unknown; userId?: unknown };
  if (reason !== 'user_not_member' || typeof userId !== 'string') return null;
  return userId;
}

/**
 * Phrase à afficher si `err` est un refus « pas membre », sinon `null` (à
 * l'appelant de retomber sur son message habituel).
 *
 * Nomme la personne quand `members` la connaît encore — c'est précisément le
 * cas réel, puisque c'est ce cache périmé qui l'a proposée. L'appelant doit
 * ensuite rafraîchir cette liste : c'est le second effet attendu, pas
 * seulement le message.
 */
export function describeUserNotMember(
  err: unknown,
  members: readonly { userId: string; displayName: string }[] | undefined,
): string | null {
  const userId = refusedUserId(err);
  if (userId === null) return null;
  const name = members?.find((m) => m.userId === userId)?.displayName;
  return name ? `${name} ne fait plus partie du groupe.` : GENERIC;
}
