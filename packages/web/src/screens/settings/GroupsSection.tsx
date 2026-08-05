/**
 * GroupsSection — onglet "Groupes" de Settings (MAN-192 Phase 1 Task 2).
 *
 * Liste TOUS les groupes du viewer — owner, admin ou simple membre confondus,
 * aucun filtre par rôle — sous forme d'accordéon fermé par défaut. Déplier
 * une ligne révèle `GroupMembersPanel`, extrait de `GroupMembersScreen` en
 * MAN-192 Task 1 pour être réutilisable ici avec les mêmes `groupId` /
 * `viewerRole` que la route plein écran `/groups/:groupId/members`.
 *
 * `viewerRole` est lu directement depuis `group.role` (renvoyé par
 * `GET /groups`, cf. `groupToDto` côté backend) plutôt que dérivé de la
 * liste des membres comme le fait `GroupMembersScreen` : `useGroups` a déjà
 * cette info par construction (c'est la liste des groupes *du viewer*), pas
 * besoin d'un aller-retour supplémentaire.
 *
 * Volontairement absents à ce stade (tranches futures du même ticket) : la
 * section invitations (Phase 2), le bouton "Créer un groupe" et l'état vide
 * "aucun groupe" (Phase 3).
 */
import { useState } from 'react';

import { PhIcon } from '@/components/ui';
import { useGroups, type Group } from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { GroupMembersPanel } from '@/screens/app/GroupMembersPanel';

import { Card, Divider, SectionTitle } from './primitives';

const ROLE_LABEL: Record<NonNullable<Group['role']>, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
};

export function GroupsSection() {
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];

  // Un `Set` d'ids ouverts plutôt qu'un seul id sélectionné : chaque groupe
  // se déplie/replie indépendamment des autres (spec explicite MAN-192, pas
  // un accordéon exclusif au sens strict).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggle(groupId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <>
      <SectionTitle title="Groupes" subtitle="Gère les membres de tes groupes" />

      {groupsQ.isError ? (
        <div style={{ padding: '16px 24px', fontSize: 13, color: NX.error }}>
          Impossible de charger tes groupes.
        </div>
      ) : groupsQ.isPending ? (
        <div style={{ padding: '16px 24px', fontSize: 13, color: NX.fgMuted }}>Chargement…</div>
      ) : (
        <div
          style={{
            padding: '16px 12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {groups.map((group) => {
            const isOpen = expandedIds.has(group.id);
            return (
              <Card key={group.id}>
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '12px 16px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  <PhIcon name={isOpen ? 'caretDown' : 'caretRight'} size={14} color={NX.fgGhost} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: NX.fg,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.name}
                  </span>
                  {group.role ? (
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
                      {ROLE_LABEL[group.role]}
                    </span>
                  ) : null}
                </button>

                {isOpen ? (
                  <>
                    <Divider />
                    <div style={{ padding: '14px 16px' }}>
                      <GroupMembersPanel groupId={group.id} viewerRole={group.role} />
                    </div>
                  </>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
