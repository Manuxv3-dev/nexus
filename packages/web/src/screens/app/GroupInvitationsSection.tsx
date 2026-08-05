/**
 * GroupInvitationsSection — sous-section "Invitations" du panel Groupes de
 * Settings (MAN-193 Phase 2, Tasks 2 & 3). Rendue par `GroupMembersPanel`,
 * juste après la liste des membres — permet à un admin+ de consulter les
 * liens d'invitation actifs, en créer un nouveau et en révoquer un existant,
 * sans quitter l'accordéon Settings.
 *
 * `useListInvitations` est réservé aux admin+ du groupe côté backend
 * (`requireGroupRole(req, 'admin')`, 403 sinon) : `canManage` est donc passé
 * tel quel comme `enabled` au hook, jamais délégué au hasard du montage —
 * un viewer `member` (ou rôle pas encore résolu par l'appelant) ne déclenche
 * JAMAIS la requête.
 *
 * La zone de contenu se branche d'abord sur la connaissance du rôle, PAS sur
 * le contenu de la liste : un rôle pas encore résolu (`viewerRole ===
 * undefined`) ne rend rien (même convention que `showActions` dans
 * `GroupMembersPanel`), un viewer `member` voit "Réservé aux admins du
 * groupe" (jamais "aucune invitation active" — le client n'a rien demandé au
 * serveur, il ne peut pas l'affirmer), et seul un admin+ voit la chaîne
 * loading → erreur → vide → liste. Le bouton "Créer une invitation" reste lui
 * TOUJOURS rendu (grisé, pas masqué) quel que soit le rôle : un bouton
 * désactivé dit vrai ("tu ne peux pas faire ça d'ici"), contrairement à une
 * liste qui prétendrait avoir vérifié un contenu jamais demandé. Le serveur
 * reste la seule autorité (403 sinon).
 *
 * "Créer une invitation" (Task 3) réutilise `useCreateInvitation` tel quel
 * (déjà câblé pour invalider `['invitations', groupId]`, cf. Task 1) : la
 * nouvelle invitation apparaît dans la liste via ce même mécanisme
 * d'invalidation, sans état local à synchroniser manuellement.
 */
import { Button, CopyLinkButton } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/groupRoles';
import {
  formatInvitationExpiry,
  formatInvitationUsage,
  useCreateInvitation,
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

/**
 * Miroir des 3 conditions de validité vérifiées côté backend dans
 * `acceptInvitation` (service.ts) : une invitation révoquée, expirée, ou
 * dont le quota d'utilisations est atteint n'est plus utilisable — ne pas
 * la présenter comme active malgré le fait que `listInvitationsForGroup`
 * ne filtre rien côté serveur.
 *
 * `expiresAt` est non-nullable côté DTO (`InvitationSchema` dans
 * `queries.ts`, MAN-198 Item 4) : le backend calcule toujours une date
 * d'expiration réelle, pas de garde `!== null` à faire ici.
 */
function isInvitationActive(inv: InvitationDto): boolean {
  if (inv.revokedAt !== null) return false;
  if (new Date(inv.expiresAt).getTime() < Date.now()) return false;
  if (inv.maxUses !== null && inv.usedCount >= inv.maxUses) return false;
  return true;
}

export function GroupInvitationsSection({ groupId, viewerRole }: GroupInvitationsSectionProps) {
  const canManage = viewerRole === 'owner' || viewerRole === 'admin';
  const roleKnown = viewerRole !== undefined;
  const invitationsQ = useListInvitations(groupId, canManage);
  const createInvitation = useCreateInvitation();

  const activeInvitations = (invitationsQ.data ?? []).filter(isInvitationActive);

  return (
    <div style={{ marginTop: 20 }}>
      {/* `<h2>`, pas `<h3>` : MAN-198 Item 3b — sibling de `<h2>Membres</h2>`
          (`GroupMembersPanel.tsx`, rendu juste avant sur la route plein écran
          `/groups/:groupId/members`), pas son enfant. Les deux sections ne
          sont pas imbriquées l'une dans l'autre malgré l'ordre visuel. */}
      <h2 style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: '0 0 10px' }}>
        Invitations
      </h2>

      {!roleKnown ? null : !canManage ? (
        <div style={{ color: NX.fgDim, fontSize: 13 }}>Réservé aux admins du groupe.</div>
      ) : invitationsQ.isLoading ? (
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
            <InvitationRow key={invitation.id} groupId={groupId} invitation={invitation} />
          ))}
        </ul>
      )}

      <div style={{ marginTop: 12 }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => createInvitation.mutate({ groupId })}
          disabled={!canManage || createInvitation.isPending}
          title={canManage ? undefined : 'Réservé aux admins du groupe'}
        >
          {createInvitation.isPending ? 'Création…' : 'Créer une invitation'}
        </Button>
        {createInvitation.isError ? (
          <div style={{ color: NX.error, fontSize: 12, marginTop: 6 }}>
            Impossible de créer l&apos;invitation.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Une ligne d'invitation active — lien copiable + métadonnées + révocation.
 * L'interaction de copie vit dans `CopyLinkButton` (`@/components/ui`,
 * extrait en MAN-198 Item 1 de cette implémentation-ci — c'était déjà la
 * version correcte, cf. son JSDoc), partagée avec `InviteDialog`
 * (`GroupMenu.tsx`).
 *
 * N'accepte plus de prop `canManage` : ce composant n'est monté que depuis la
 * branche `canManage === true` de `GroupInvitationsSection` (cf. son JSDoc) —
 * un viewer sans le rang requis ne voit jamais la liste, donc jamais cette
 * ligne. Le bouton "Révoquer" est donc toujours actif ici.
 */
function InvitationRow({ groupId, invitation }: { groupId: string; invitation: InvitationDto }) {
  const revokeInvitation = useRevokeInvitation();
  const link = `${window.location.origin}/invite/${invitation.slug}`;

  return (
    <li style={{ padding: '8px 4px', borderBottom: `0.5px solid ${NX.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <CopyLinkButton link={link} />
        <Button
          variant="destructive"
          size="sm"
          onClick={() => revokeInvitation.mutate({ groupId, invitationId: invitation.id })}
          disabled={revokeInvitation.isPending}
        >
          Révoquer
        </Button>
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 4 }}>
        {ROLE_LABEL[invitation.role]} · {formatInvitationUsage(invitation)} ·{' '}
        {formatInvitationExpiry(invitation)}
      </div>
      {revokeInvitation.isError ? (
        <div style={{ color: NX.error, fontSize: 12, marginTop: 4 }}>
          Impossible de révoquer l&apos;invitation.
        </div>
      ) : null}
    </li>
  );
}
