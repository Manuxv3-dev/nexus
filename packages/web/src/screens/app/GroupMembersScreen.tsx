/**
 * GroupMembersScreen — gestion des membres d'un groupe (MAN-180 Phase 1
 * Task 4).
 *
 * Liste tous les membres du groupe avec leur rôle, et propose un bouton
 * promouvoir/rétrograder sur les lignes que le viewer courant est autorisé
 * à gérer.
 *
 * `canManageRole` ci-dessous est un MIROIR CLIENT de la règle appliquée côté
 * backend (`packages/backend/src/routes/groups/service.ts`) : un rang
 * strictement supérieur est requis, jamais égal ni inférieur, et jamais sur
 * sa propre ligne. Elle ne sert qu'à masquer les actions inutiles dans
 * l'UI — le serveur reste la seule autorité (403 `PERMISSION_DENIED` sinon).
 *
 * Page pleine, hors AppShell (même registre que `SettingsScreen`),
 * accessible depuis l'entrée "Membres du groupe" du `GroupMenu`.
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Avatar, Button, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroupMembers, useUpdateGroupMemberRole, type GroupMember } from '@/lib/queries';
import { NX } from '@/lib/tokens';

type GroupRole = GroupMember['role'];

const ROLE_RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 };
const ROLE_LABEL: Record<GroupRole, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
};

/**
 * Rang du `viewerRole` strictement supérieur à celui de `targetRole` — et
 * jamais sur sa propre ligne, même si un rang théoriquement égal passait
 * la première condition (garde-fou explicite, redondant avec le rang égal
 * mais posé pour rester robuste à une évolution du barème).
 */
function canManageRole(
  viewerRole: GroupRole,
  viewerId: string,
  target: Pick<GroupMember, 'userId' | 'role'>,
): boolean {
  if (target.userId === viewerId) return false;
  return ROLE_RANK[viewerRole] > ROLE_RANK[target.role];
}

export function GroupMembersScreen() {
  const { groupId } = useParams({ from: '/groups/$groupId/members' });
  const navigate = useNavigate();
  const currentUserId = useAuth((s) => s.user?.id);
  const membersQ = useGroupMembers(groupId);
  const updateRole = useUpdateGroupMemberRole();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // État local synchronisé depuis la query : permet de refléter
  // immédiatement la réponse HTTP d'une mutation de rôle sans attendre le
  // WS `member:*` (posé dans une tâche parallèle) ni un refetch.
  const [members, setMembers] = useState<GroupMember[]>(membersQ?.data ?? []);
  useEffect(() => {
    if (membersQ?.data) setMembers(membersQ.data);
  }, [membersQ?.data]);

  const viewerRole = members.find((m) => m.userId === currentUserId)?.role;

  function handleToggleRole(member: GroupMember) {
    const nextRole: 'admin' | 'member' = member.role === 'member' ? 'admin' : 'member';
    setPendingUserId(member.userId);
    updateRole
      .mutateAsync({ groupId, userId: member.userId, role: nextRole })
      .then((updated) => {
        setMembers((list) => list.map((m) => (m.userId === updated.userId ? updated : m)));
      })
      .catch(() => {
        // L'erreur est déjà loggée par useMutation ; l'utilisateur peut
        // simplement retenter, la ligne reprend son état précédent.
      })
      .finally(() => setPendingUserId(null));
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: NX.bg,
        color: NX.fg,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 20px',
          borderBottom: `0.5px solid ${NX.border}`,
        }}
      >
        <Button
          variant="icon"
          size="icon"
          className="h-8 w-8"
          onClick={() => void navigate({ to: '/app' })}
          aria-label="Retour"
        >
          <PhIcon name="caretLeft" size={16} />
        </Button>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Membres du groupe</h1>
      </header>

      <main style={{ padding: '16px 20px', maxWidth: 640 }}>
        {membersQ.isLoading ? (
          <div style={{ color: NX.fgMuted, fontSize: 13 }}>Chargement…</div>
        ) : membersQ.isError ? (
          <div style={{ color: NX.error, fontSize: 13 }}>
            Impossible de charger les membres du groupe.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {members.map((member) => {
              const manageable =
                viewerRole !== undefined &&
                currentUserId !== undefined &&
                canManageRole(viewerRole, currentUserId, member);
              const actionLabel =
                member.role === 'member' ? 'Promouvoir admin' : 'Rétrograder membre';

              return (
                <li
                  key={member.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 4px',
                    borderBottom: `0.5px solid ${NX.border}`,
                  }}
                >
                  <Avatar name={member.displayName} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {member.displayName}
                    </div>
                    <div style={{ fontSize: 11, color: NX.fgDim }}>{member.email}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: NX.radiusPill,
                      background: NX.primaryMuted,
                      color: NX.primaryText,
                      flexShrink: 0,
                    }}
                  >
                    {ROLE_LABEL[member.role]}
                  </span>
                  {manageable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleRole(member)}
                      disabled={pendingUserId === member.userId}
                    >
                      {pendingUserId === member.userId ? '…' : actionLabel}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
