/**
 * GroupMembersPanel — liste des membres d'un groupe avec leur rôle, et
 * actions promouvoir/rétrograder/retirer un membre + transfert de propriété
 * (MAN-180 Phase 1 Task 4, MAN-181 Phase 2 Task 4, MAN-182 Phase 3 Task 4).
 *
 * Extrait de `GroupMembersScreen` en MAN-192 (Phase 1 Task 1) pour être
 * réutilisable ailleurs que sur la route plein écran
 * `/groups/:groupId/members` — par ex. inline dans l'accordéon "Groupes" de
 * Settings (MAN-192 Task 2). Ce composant ne porte que le contenu substantiel
 * (liste + actions + dialogs) ; le chrome de page (header, bouton retour) et
 * la résolution de `groupId`/`viewerRole` restent à la charge de l'appelant.
 *
 * `canManageRole` ci-dessous est un MIROIR CLIENT de la règle appliquée côté
 * backend (`packages/backend/src/routes/groups/service.ts`) : un rang
 * strictement supérieur est requis, jamais égal ni inférieur, et jamais sur
 * sa propre ligne. Elle ne sert qu'à GRISER (désactiver) les actions
 * inutiles dans l'UI (MAN-192 Phase 1 Task 3) — jamais à les masquer, pour
 * que l'utilisateur comprenne ce qu'il pourrait faire avec un rang
 * supérieur plutôt que de croire l'action indisponible. Le serveur reste la
 * seule autorité (403 `PERMISSION_DENIED` sinon).
 *
 * `viewerRole` est reçu en prop plutôt que dérivé en interne : l'appelant
 * (route plein écran `GroupMembersScreen`, ou futur accordéon Settings) sait
 * déjà déterminer le rôle du viewer depuis son propre contexte, un composant
 * réutilisable n'a pas à imposer sa propre source de vérité pour cette
 * donnée. `undefined` reproduit l'état "on ne sait pas encore" (ex. chargement
 * de la liste des membres pas terminé côté appelant) : aucune action de
 * gestion n'est alors proposée, même comportement qu'avant l'extraction.
 */
import { useEffect, useState } from 'react';

import { Avatar, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useGroupMembers,
  useLeaveGroup,
  useTransferGroupOwnership,
  useUpdateGroupMemberRole,
  type GroupMember,
} from '@/lib/queries';
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

export interface GroupMembersPanelProps {
  groupId: string;
  viewerRole: GroupRole | undefined;
}

export function GroupMembersPanel({ groupId, viewerRole }: GroupMembersPanelProps) {
  const currentUserId = useAuth((s) => s.user?.id);
  const membersQ = useGroupMembers(groupId);
  const updateRole = useUpdateGroupMemberRole();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GroupMember | null>(null);

  // État local synchronisé depuis la query : permet de refléter
  // immédiatement la réponse HTTP d'une mutation de rôle sans attendre
  // l'aller-retour WS `member:role_updated` (câblé dans
  // `useKillerFeaturesWs`) ni un refetch.
  const [members, setMembers] = useState<GroupMember[]>(membersQ?.data ?? []);
  useEffect(() => {
    if (membersQ?.data) setMembers(membersQ.data);
  }, [membersQ?.data]);

  const transferCandidates = members.filter((m) => m.userId !== currentUserId);

  /**
   * Miroir client de `transferOwnership` côté backend (previous owner →
   * `admin`, cible → `owner`) : mêmes raisons que `handleToggleRole`, le
   * endpoint ne renvoie que `{ ok: true }`, pas de DTO à jour, donc l'état
   * local se calcule ici plutôt que d'attendre le WS `group:ownership_
   * transferred` (câblé dans `useKillerFeaturesWs`) ou un refetch.
   */
  function handleOwnershipTransferred(newOwnerUserId: string) {
    setMembers((list) =>
      list.map((m) => {
        if (m.userId === newOwnerUserId) return { ...m, role: 'owner' };
        if (m.role === 'owner') return { ...m, role: 'admin' };
        return m;
      }),
    );
  }

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

  /**
   * Retire `userId` de la liste locale après un kick confirmé — même
   * principe que `handleOwnershipTransferred` : le endpoint DELETE ne
   * renvoie qu'un 204, pas de DTO à jour, et on ne veut pas attendre un
   * refetch. Le WS `member:removed` (câblé dans `useKillerFeaturesWs`)
   * réconcilie les autres onglets/utilisateurs de toute façon.
   */
  function handleMemberRemoved(userId: string) {
    setMembers((list) => list.filter((m) => m.userId !== userId));
  }

  return (
    <>
      {viewerRole !== undefined ? (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTransferDialogOpen(true)}
            disabled={viewerRole !== 'owner' || transferCandidates.length === 0}
          >
            Transférer la propriété
          </Button>
          {viewerRole === 'owner' && transferCandidates.length === 0 ? (
            <span style={{ fontSize: 12, color: NX.fgDim }}>
              Aucun autre membre à qui transférer la propriété.
            </span>
          ) : null}
        </div>
      ) : null}

      {membersQ.isLoading ? (
        <div style={{ color: NX.fgMuted, fontSize: 13 }}>Chargement…</div>
      ) : membersQ.isError ? (
        <div style={{ color: NX.error, fontSize: 13 }}>
          Impossible de charger les membres du groupe.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {members.map((member) => {
            // `showActions` reflète une donnée pas encore disponible (rôle
            // du viewer / identité toujours en chargement côté appelant) —
            // rien à afficher tant qu'on ne sait pas qui regarde. Une fois
            // connu, les actions sont TOUJOURS rendues (jamais masquées) ;
            // seul `canManage` détermine si elles sont actives ou grisées
            // (MAN-192 Phase 1 Task 3 : grisage plutôt que masquage).
            const showActions = viewerRole !== undefined && currentUserId !== undefined;
            const canManage =
              viewerRole !== undefined && currentUserId !== undefined
                ? canManageRole(viewerRole, currentUserId, member)
                : false;
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
                {showActions ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleRole(member)}
                      disabled={!canManage || pendingUserId === member.userId}
                    >
                      {pendingUserId === member.userId ? '…' : actionLabel}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRemoveTarget(member)}
                      disabled={!canManage}
                    >
                      Retirer
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {transferDialogOpen ? (
        <TransferOwnershipDialog
          groupId={groupId}
          candidates={transferCandidates}
          onClose={() => setTransferDialogOpen(false)}
          onTransferred={handleOwnershipTransferred}
        />
      ) : null}

      {removeTarget ? (
        <RemoveMemberDialog
          groupId={groupId}
          member={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={handleMemberRemoved}
        />
      ) : null}
    </>
  );
}

/**
 * Dialogue de transfert de propriété (MAN-181 Phase 2 Task 4) — même registre
 * visuel que `ConfirmGroupActionDialog` (`GroupMenu.tsx`) : overlay flou +
 * carte "glass". Deux étapes explicites (choix de la cible puis confirmation)
 * puisque l'action est irréversible et significative pour le viewer, qui perd
 * son rôle de propriétaire.
 */
function TransferOwnershipDialog({
  groupId,
  candidates,
  onClose,
  onTransferred,
}: {
  groupId: string;
  candidates: GroupMember[];
  onClose: () => void;
  onTransferred: (newOwnerUserId: string) => void;
}) {
  const transferOwnership = useTransferGroupOwnership();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    candidates[0]?.userId ?? null,
  );
  const [confirming, setConfirming] = useState(false);
  const busy = transferOwnership.isPending === true;
  const selected = candidates.find((m) => m.userId === selectedUserId) ?? null;

  async function handleConfirm() {
    if (!selected) return;
    try {
      await transferOwnership.mutateAsync({ groupId, newOwnerUserId: selected.userId });
      onTransferred(selected.userId);
      onClose();
    } catch {
      // L'erreur est déjà loggée par useMutation ; le dialog reste ouvert
      // pour permettre un retry manuel, même principe que
      // `ConfirmGroupActionDialog`.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          borderRadius: NX.radius,
          padding: 24,
          maxWidth: 440,
          width: '100%',
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.glassShadow,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>
          Transférer la propriété du groupe
        </h2>

        {candidates.length === 0 ? (
          <>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
              Il n'y a personne d'autre dans ce groupe : impossible de transférer la propriété pour
              l'instant.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <Button onClick={onClose} variant="primary" size="sm">
                Fermer
              </Button>
            </div>
          </>
        ) : !confirming ? (
          <>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
              Choisis le membre qui deviendra propriétaire du groupe. Cette action est irréversible
              : tu deviendras toi-même admin.
            </p>
            <label
              htmlFor="transfer-target"
              style={{ display: 'block', fontSize: 12, color: NX.fgDim, marginTop: 16 }}
            >
              Nouveau propriétaire
            </label>
            <select
              id="transfer-target"
              value={selectedUserId ?? ''}
              onChange={(e) => setSelectedUserId(e.target.value)}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '8px 10px',
                borderRadius: NX.radiusSm,
                background: NX.surface,
                border: `0.5px solid ${NX.border}`,
                color: NX.fg,
                fontSize: 13,
              }}
            >
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName} ({ROLE_LABEL[m.role]})
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={onClose} style={dialogSecondaryButtonStyle}>
                Annuler
              </button>
              <Button
                onClick={() => setConfirming(true)}
                disabled={!selected}
                variant="primary"
                size="sm"
              >
                Continuer
              </Button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
              Confirmer le transfert de la propriété à « {selected?.displayName} » ? Tu deviendras
              admin du groupe.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                style={dialogSecondaryButtonStyle}
              >
                Retour
              </button>
              <Button
                onClick={() => void handleConfirm()}
                disabled={busy}
                variant="destructive"
                size="sm"
              >
                {busy ? 'Transfert…' : 'Confirmer le transfert'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Dialogue de confirmation du retrait d'un membre / kick (MAN-182 Phase 3
 * Task 4) — même registre visuel que `TransferOwnershipDialog` et
 * `ConfirmGroupActionDialog` (`GroupMenu.tsx`) : overlay flou + carte
 * "glass", CTA `variant="destructive"`. Réutilise `useLeaveGroup` : le
 * endpoint `DELETE /groups/:groupId/members/:userId` est le même que pour un
 * self-leave, seul le `userId` diffère (celui de la cible plutôt que du
 * viewer). Une seule étape de confirmation suffit ici — contrairement au
 * transfert de propriété, la cible est déjà choisie par le clic sur la ligne.
 */
function RemoveMemberDialog({
  groupId,
  member,
  onClose,
  onRemoved,
}: {
  groupId: string;
  member: GroupMember;
  onClose: () => void;
  onRemoved: (userId: string) => void;
}) {
  const leaveGroup = useLeaveGroup();
  const busy = leaveGroup.isPending === true;

  async function handleConfirm() {
    try {
      await leaveGroup.mutateAsync({ groupId, userId: member.userId });
      onRemoved(member.userId);
      onClose();
    } catch {
      // L'erreur est déjà loggée par useMutation ; le dialog reste ouvert
      // pour permettre un retry manuel, même principe que
      // `ConfirmGroupActionDialog`/`TransferOwnershipDialog`.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          borderRadius: NX.radius,
          padding: 24,
          maxWidth: 440,
          width: '100%',
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.glassShadow,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>
          Retirer « {member.displayName} » du groupe ?
        </h2>
        <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
          Cette personne perdra immédiatement l'accès aux conversations et à l'organisation de ce
          groupe. Elle pourra être réinvitée plus tard si besoin.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={dialogSecondaryButtonStyle}
          >
            Annuler
          </button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={busy}
            variant="destructive"
            size="sm"
          >
            {busy ? 'Retrait…' : 'Retirer du groupe'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const dialogSecondaryButtonStyle = {
  padding: '8px 18px',
  borderRadius: NX.radiusPill,
  background: 'transparent',
  color: NX.fgMuted,
  border: `1px solid ${NX.border}`,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
} as const;
