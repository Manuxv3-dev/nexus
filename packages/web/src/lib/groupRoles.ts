/**
 * `ROLE_LABEL` — libellés FR partagés pour les rôles de groupe, extraits en
 * MAN-198 (revue) de trois copies indépendantes et identiques
 * (`GroupInvitationsSection.tsx`, `GroupMembersPanel.tsx`,
 * `GroupsSection.tsx`). Ce fichier n'a aucune dépendance vers ces trois
 * écrans (ni vers rien d'autre côté app) : c'est la feuille de l'arbre
 * d'imports, plus de cycle possible — même raison d'être que
 * `screens/settings/primitives.tsx` (cf. son JSDoc).
 *
 * `GroupRole` reflète l'union `'owner' | 'admin' | 'member'` figée côté
 * backend (`GroupMemberSchema`/`GroupSchema` dans `lib/queries.ts`) ; les
 * call sites qui ont déjà un alias de type plus précis pour leur contexte
 * (`GroupMember['role']`, `NonNullable<Group['role']>`) peuvent le garder
 * tel quel — les deux désignent le même type sous-jacent, seule la valeur
 * `ROLE_LABEL` a besoin d'être partagée.
 */
export type GroupRole = 'owner' | 'admin' | 'member';

export const ROLE_LABEL: Record<GroupRole, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
};
