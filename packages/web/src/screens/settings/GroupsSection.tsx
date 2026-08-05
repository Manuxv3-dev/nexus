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
 * ci-dessous) et l'état vide "aucun groupe". `CreateGroupButton` reprend le
 * pattern de `NewGroupButton` (`AppShell.tsx`, création depuis la sidebar) —
 * même hook `useCreateGroup`, même message d'erreur ("Le nom est
 * obligatoire."), même forme générale — mais le comportement n'est pas
 * strictement identique : ici le submit reste toujours possible et l'erreur
 * inline gère le nom vide, alors que la version sidebar désactive son bouton
 * "Créer" via `disabled={!name.trim()}` (rendant son erreur inline quasi
 * inatteignable) et se ferme au clic extérieur, ce que celle-ci ne fait pas.
 * Volontairement PAS extrait en composant partagé : le contexte de
 * déclenchement diffère (bouton de header Settings vs icône 38×38 de
 * sidebar) et une seule réutilisation ne justifie pas l'abstraction (MVP
 * d'abord, cf. CLAUDE.md).
 */
import { useEffect, useRef, useState } from 'react';

import { Button, PhIcon } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/groupRoles';
import { useCreateGroup, useGroups } from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { GroupMembersPanel } from '@/screens/app/GroupMembersPanel';

import { Card, Divider, SectionTitle } from './primitives';

/**
 * Bouton "Créer un groupe" + mini-formulaire inline (MAN-194 Phase 3 Task 1).
 *
 * `prominent` bascule l'apparence entre le point d'entrée compact du header
 * (`variant="secondary"`, `size="sm"`) et le CTA plus visible utilisé dans
 * l'état vide (`variant="primary"`, `size="md"`) — même composant, même
 * logique, deux gabarits selon le contexte d'appel.
 */
function CreateGroupButton({ prominent = false }: { prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createGroup = useCreateGroup();

  // Focus auto à l'ouverture, reset du form à la fermeture (annulation ou
  // succès) — même comportement que `NewGroupButton`.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setName('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Le nom est obligatoire.');
      return;
    }
    setError(null);
    try {
      // `onSuccess` de `useCreateGroup` invalide déjà `['groups']` (cf.
      // `lib/queries.ts`) : le nouveau groupe apparaît via le refetch, pas
      // besoin de patcher le cache ici.
      await createGroup.mutateAsync({ name: trimmed });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur à la création.');
    }
  }

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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, width: prominent ? 260 : 220 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="La Bande du 11e"
        aria-label="Nom du groupe"
        disabled={createGroup.isPending}
        style={{
          padding: '8px 10px',
          fontSize: 13,
          borderRadius: NX.radiusSm,
          border: `1px solid ${NX.border}`,
          background: NX.bg,
          color: NX.fg,
          outline: 'none',
        }}
      />
      {error && <div style={{ fontSize: 11, color: NX.error }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: prominent ? 'center' : 'flex-end' }}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={createGroup.isPending}
        >
          Annuler
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={createGroup.isPending}
          disabled={createGroup.isPending}
        >
          Créer
        </Button>
      </div>
    </form>
  );
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
          Tu n&apos;appartiens à aucun groupe pour l&apos;instant.
        </div>
        <div style={{ fontSize: 12, color: NX.fgDim, maxWidth: 320 }}>
          Crée ton premier groupe pour organiser événements, sondages, dépenses et todos avec tes
          amis.
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
