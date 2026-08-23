/**
 * Miroir client des règles d'autorisation du backend sur les items
 * d'organisation (events, polls, todo-lists, expenses).
 *
 * Comme `canManageRole` dans `GroupMembersPanel`, ce module ne sert qu'à
 * **griser** les actions dans l'UI — jamais à décider. Le serveur reste la
 * seule autorité et répond `PERMISSION_DENIED` (403) quoi qu'affiche le
 * client.
 *
 * MAN-246 : les 4 dashboards calculaient tous `canEdit={createdBy === user.id}`,
 * strictement plus restrictif que le serveur, qui autorise aussi les
 * owner/admin du groupe. Conséquence : un owner ne voyait pas des actions
 * qu'il avait pourtant le droit de faire.
 *
 * Une seule capacité et non deux (`canEdit` / `canDelete`) : la même phase a
 * durci `PATCH` sur events/polls/todo-lists pour l'aligner sur `DELETE` — les
 * deux verbes partagent désormais exactement cette règle sur les quatre
 * ressources. Deux booléens toujours égaux seraient une distinction sans
 * différence, à re-vérifier à chaque lecture.
 */
import type { Group } from './queries';

export interface ManageItemParams {
  /** Utilisateur courant. `undefined` pendant la résolution de l'auth. */
  userId: string | undefined;
  /**
   * Auteur de l'item — `createdBy` pour un event/poll/todo-list, `paidBy`
   * pour une dépense (c'est le payeur qui fait autorité côté serveur).
   */
  authorId: string;
  /** Rôle du viewer dans le groupe propriétaire, tel que servi par `GET /groups`. */
  role: Group['role'];
}

/**
 * `true` si le viewer peut modifier ou supprimer cet item : il en est l'auteur,
 * ou il est owner/admin du groupe.
 *
 * Retourne `false` tant que l'utilisateur ou le rôle sont inconnus — ne rien
 * promettre sur la base d'une donnée absente, même principe que MAN-244.
 */
export function canManageGroupItem({ userId, authorId, role }: ManageItemParams): boolean {
  if (!userId) return false;
  if (authorId === userId) return true;
  return role === 'owner' || role === 'admin';
}
