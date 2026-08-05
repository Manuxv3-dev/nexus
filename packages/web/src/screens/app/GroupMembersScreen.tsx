/**
 * GroupMembersScreen — route plein écran pour la gestion des membres d'un
 * groupe (MAN-180 Phase 1 Task 4), accessible depuis l'entrée "Membres du
 * groupe" du `GroupMenu`.
 *
 * Depuis MAN-192 (Phase 1 Task 1), le contenu substantiel (liste des
 * membres, actions promouvoir/rétrograder/retirer, transfert de propriété,
 * dialogs de confirmation) vit dans `GroupMembersPanel`, réutilisable ailleurs
 * que sur cette route (accordéon "Groupes" de Settings, MAN-192 Task 2). Ce
 * composant ne porte plus que le chrome de page (header + bouton retour) et
 * la résolution de `groupId`/`viewerRole` depuis la route.
 */
import { useNavigate, useParams } from '@tanstack/react-router';

import { Button, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useGroupMembers } from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { GroupMembersPanel } from '@/screens/app/GroupMembersPanel';

export function GroupMembersScreen() {
  const { groupId } = useParams({ from: '/groups/$groupId/members' });
  const navigate = useNavigate();
  const currentUserId = useAuth((s) => s.user?.id);
  const membersQ = useGroupMembers(groupId);
  const viewerRole = membersQ.data?.find((m) => m.userId === currentUserId)?.role;

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
        <GroupMembersPanel groupId={groupId} viewerRole={viewerRole} />
      </main>
    </div>
  );
}
