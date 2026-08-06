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
 * MAN-194 Phase 3 ajoute le bouton "Créer un groupe" (`CreateGroupButton`
 * ci-dessous) et l'état vide "aucun groupe". MAN-200 extrait la logique de
 * form/validation/mutation dans `CreateGroupForm`
 * (`@/components/groups/CreateGroupForm`), partagée avec `NewGroupButton`
 * (`AppShell.tsx`, création depuis la sidebar) — `CreateGroupButton` ne garde
 * plus que son propre bouton déclencheur (compact vs `prominent`).
 */
import { useState } from 'react';

import {
  CreateGroupForm,
  GROUPS_EMPTY_STATE_BODY,
  GROUPS_EMPTY_STATE_TITLE,
} from '@/components/groups/CreateGroupForm';
import { Button, PhIcon } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/groupRoles';
import { useGroups } from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { GroupMembersPanel } from '@/screens/app/GroupMembersPanel';

import { Card, Divider, SectionTitle } from './primitives';

/**
 * Bouton "Créer un groupe" + mini-formulaire inline (MAN-194 Phase 3 Task 1).
 *
 * `prominent` bascule l'apparence entre le point d'entrée compact du header
 * (`variant="secondary"`, `size="sm"`) et le CTA plus visible utilisé dans
 * l'état vide (`variant="primary"`, `size="md"`) — même composant, même
 * logique, deux gabarits selon le contexte d'appel. Le form lui-même (input,
 * validation, mutation) vit dans `CreateGroupForm` (MAN-200), partagé avec
 * `NewGroupButton` de `AppShell.tsx`.
 */
function CreateGroupButton({ prominent = false }: { prominent?: boolean }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant={prominent ? 'primary' : 'secondary'}
        size={prominent ? 'md' : 'sm'}
        onClick={() => setOpen(true)}
      >
        <PhIcon name="plus" size={14} />
        Créer un groupe
      </Button>
    );
  }

  return <CreateGroupForm onClose={() => setOpen(false)} prominent={prominent} />;
}

/**
 * État vide (MAN-194 Phase 3 Task 2) — affiché quand le viewer n'appartient
 * à aucun groupe (post-chargement, sans erreur). Foregrounde le CTA de
 * création plutôt que de laisser un accordéon silencieusement vide.
 */
function GroupsEmptyState() {
  return (
    <div style={{ padding: '16px 12px 24px' }}>
      <div
        data-testid="groups-empty-state"
        style={{
          padding: '32px 24px',
          borderRadius: NX.radius,
          border: `1px dashed ${NX.border}`,
          background: NX.elevated,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>
          {GROUPS_EMPTY_STATE_TITLE}
        </div>
        <div style={{ fontSize: 12, color: NX.fgDim, maxWidth: 320 }}>
          {GROUPS_EMPTY_STATE_BODY}
        </div>
        <CreateGroupButton prominent />
      </div>
    </div>
  );
}

export function GroupsSection() {
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const isEmpty = !groupsQ.isPending && !groupsQ.isError && groups.length === 0;

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
      <SectionTitle
        title="Groupes"
        subtitle="Gère les membres de tes groupes"
        action={!isEmpty ? <CreateGroupButton /> : undefined}
      />

      {groupsQ.isError ? (
        <div style={{ padding: '16px 24px', fontSize: 13, color: NX.error }}>
          Impossible de charger tes groupes.
        </div>
      ) : groupsQ.isPending ? (
        <div style={{ padding: '16px 24px', fontSize: 13, color: NX.fgMuted }}>Chargement…</div>
      ) : isEmpty ? (
        <GroupsEmptyState />
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
