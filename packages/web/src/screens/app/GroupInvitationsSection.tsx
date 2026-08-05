/**
 * GroupInvitationsSection — sous-section "Invitations" du panel Groupes de
 * Settings (MAN-193 Phase 2 Task 2). Rendue par `GroupMembersPanel`, juste
 * après la liste des membres — permet à un admin+ de consulter les liens
 * d'invitation actifs et d'en révoquer un, sans quitter l'accordéon Settings.
 *
 * `useListInvitations` est réservé aux admin+ du groupe côté backend
 * (`requireGroupRole(req, 'admin')`, 403 sinon) : `canManage` est donc passé
 * tel quel comme `enabled` au hook, jamais délégué au hasard du montage —
 * un viewer `member` (ou rôle pas encore résolu par l'appelant) ne déclenche
 * JAMAIS la requête. La query restant alors non exécutée (`isLoading`/
 * `isError` à `false`, `data` à `undefined`), le rendu retombe naturellement
 * sur l'état "aucune invitation active" plutôt que sur un état de chargement
 * ou d'erreur qui laisserait croire qu'une requête a été tentée.
 *
 * Ce composant NE duplique PAS ce garde-fou par un branchement explicite
 * `!canManage` sur le contenu de la liste elle-même : `canManage` ne pilote
 * que (a) l'`enabled` du hook et (b) le `disabled` du bouton "Révoquer" —
 * jamais la visibilité de la liste, qui reste TOUJOURS rendue (grisée, pas
 * masquée), même philosophie que les actions de `GroupMembersPanel` (cf. son
 * JSDoc) : griser plutôt que masquer, pour que l'utilisateur comprenne ce
 * qu'il pourrait faire avec un rang supérieur plutôt que de croire l'action
 * absente. Le serveur reste la seule autorité (403 sinon).
 */
import { useState } from 'react';

import { Button } from '@/components/ui';
import {
  useListInvitations,
  useRevokeInvitation,
  type GroupMember,
  type InvitationDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

type GroupRole = GroupMember['role'];

export interface GroupInvitationsSectionProps {
  groupId: string;
  viewerRole: GroupRole | undefined;
}

export function GroupInvitationsSection({ groupId, viewerRole }: GroupInvitationsSectionProps) {
  const canManage = viewerRole === 'owner' || viewerRole === 'admin';
  const invitationsQ = useListInvitations(groupId, canManage);

  // Filtre client des invitations révoquées : `listInvitationsForGroup`
  // côté backend renvoie TOUTES les invitations (actives et révoquées),
  // sans filtre `revokedAt IS NULL` — cf. JSDoc de `useListInvitations`.
  const activeInvitations = (invitationsQ.data ?? []).filter((inv) => inv.revokedAt === null);

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: '0 0 10px' }}>
        Invitations
      </h3>

      {invitationsQ.isLoading ? (
        <div style={{ color: NX.fgMuted, fontSize: 13 }}>Chargement…</div>
      ) : invitationsQ.isError ? (
        <div style={{ color: NX.error, fontSize: 13 }}>
          Impossible de charger les invitations du groupe.
        </div>
      ) : activeInvitations.length === 0 ? (
        <div style={{ color: NX.fgDim, fontSize: 13 }}>
          Aucune invitation active pour ce groupe.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {activeInvitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              groupId={groupId}
              invitation={invitation}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Une ligne d'invitation active — lien copiable + révocation. Interaction de
 * copie identique à `InviteDialog` (`GroupMenu.tsx`) : `clipboard.writeText`
 * + libellé "Copié !" pendant ~2s. L'état `copied` est local à la ligne (pas
 * partagé entre invitations).
 */
function InvitationRow({
  groupId,
  invitation,
  canManage,
}: {
  groupId: string;
  invitation: InvitationDto;
  canManage: boolean;
}) {
  const revokeInvitation = useRevokeInvitation();
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/invite/${invitation.slug}`;

  function handleCopy() {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 4px',
        borderBottom: `0.5px solid ${NX.border}`,
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: NX.fg,
          fontFamily: 'ui-monospace, monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {link}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          background: copied ? NX.successBg : 'transparent',
          color: copied ? NX.success : NX.primaryText,
          border: `0.5px solid ${copied ? NX.success : NX.border}`,
          padding: '4px 10px',
          borderRadius: NX.radiusPill,
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {copied ? 'Copié !' : 'Copier'}
      </button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => revokeInvitation.mutate({ groupId, invitationId: invitation.id })}
        disabled={!canManage || revokeInvitation.isPending}
        title={canManage ? undefined : 'Réservé aux admins du groupe'}
      >
        Révoquer
      </Button>
    </li>
  );
}
