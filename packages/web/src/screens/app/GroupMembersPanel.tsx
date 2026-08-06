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
 * Sa propre ligne (`isSelfRow`, cf. le render) est un cas À PART, traité
 * différemment : le backend autorise explicitement le self-leave (route
 * DELETE .../members/:userId, `isSelf` bypass `canManageRole` — cf.
 * `index.ts`/`service.ts`) et un `removeMember` sans `expectedCurrentRole`
 * pour ce cas précis. Rendre "Retirer" disabled sur sa propre ligne serait
 * donc une fausse affirmation ("tu ne peux pas quitter") contredite par le
 * serveur. Les deux boutons d'action promouvoir/rétrograder/retirer sont
 * donc entièrement SUPPRIMÉS (pas seulement désactivés) sur la ligne du
 * viewer. Ce n'est PAS un retour en arrière sur le principe "griser plutôt
 * que masquer" ci-dessus (qui concerne le grisage par RANG sur les AUTRES
 * lignes) : c'est un cas distinct qui a sa propre action dédiée.
 *
 * MAN-196 câble cette action dédiée : un bouton "Quitter le groupe" apparaît
 * sur `isSelfRow`, mais seulement pour un viewer non-owner — un owner ne peut
 * pas quitter sans transférer la propriété au préalable (règle backend
 * existante), et lui proposer un bouton qui échouerait systématiquement
 * reproduirait exactement le problème de "UI qui ment" que ce fichier corrige
 * dans l'autre sens. Un simple texte d'aide remplace le bouton pour ce cas.
 * Confirmation obligatoire via `LeaveGroupDialog`, même registre visuel que
 * `TransferOwnershipDialog`/`RemoveMemberDialog` ci-dessous.
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

import {
  Avatar,
  Button,
  GlassDialogSecondaryButton,
  GlassDialogShell,
  useDialogCtaSize,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/groupRoles';
import {
  useGroupMembers,
  useLeaveGroup,
  useTransferGroupOwnership,
  useUpdateGroupMemberRole,
  type GroupMember,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { GroupInvitationsSection } from './GroupInvitationsSection';

type GroupRole = GroupMember['role'];

const ROLE_RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 };

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
  /**
   * Appelé après un self-leave réussi, EN PLUS de `handleMemberRemoved`
   * ci-dessous (qui retire la ligne de l'état local dans tous les cas).
   * Router-agnostic : ce composant ne connaît pas la route qui l'héberge, à
   * l'appelant de décider s'il doit s'éloigner de la page.
   *
   * Sur la route plein écran `/groups/:groupId/members`
   * (`GroupMembersScreen`), rester sur place après un self-leave laisserait
   * un écran dégradé : `viewerRole` redevient `undefined` (dérivé de la
   * liste de membres, qui ne contient plus le viewer), ET le prochain
   * refetch `['group-members']` échouera (403/404, le viewer n'est plus
   * membre) — `GroupMembersScreen` passe donc `onSelfLeft` pour naviguer
   * ailleurs. L'accordéon Settings (`GroupsSection`) n'en a pas besoin : la
   * ligne du groupe disparaît déjà via le re-render piloté par le cache
   * `['groups']`, rester sur l'écran Settings est un comportement correct.
   */
  onSelfLeft?: () => void;
}

export function GroupMembersPanel({ groupId, viewerRole, onSelfLeft }: GroupMembersPanelProps) {
  const currentUserId = useAuth((s) => s.user?.id);
  const membersQ = useGroupMembers(groupId);
  const updateRole = useUpdateGroupMemberRole();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GroupMember | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  // État local synchronisé depuis la query : permet de refléter
  // immédiatement la réponse HTTP d'une mutation de rôle sans attendre
  // l'aller-retour WS `member:role_updated` (câblé dans
  // `useKillerFeaturesWs`) ni un refetch.
  const [members, setMembers] = useState<GroupMember[]>(membersQ?.data ?? []);
  useEffect(() => {
    if (membersQ?.data) setMembers(membersQ.data);
  }, [membersQ?.data]);

  const transferCandidates = members.filter((m) => m.userId !== currentUserId);
  // Un seul point de vérité pour la condition d'activation du bouton
  // "Transférer la propriété" — évitait sinon 3 re-dérivations différemment
  // négatées (`onClick`, `aria-disabled`, `title`) du même invariant.
  const canTransfer = viewerRole === 'owner' && transferCandidates.length > 0;

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
      {/* MAN-198 Item 3b : sur la route plein écran `/groups/:groupId/members`
          (`GroupMembersScreen.tsx`), ce panel est rendu directement sous le
          `<h1>` "Membres du groupe" — sans ce `<h2>`, `GroupInvitationsSection`
          (rendue juste après, cf. plus bas) sautait de `h1` à `h3`, violation
          axe `heading-order`. Devenu sibling de son propre `<h2>` "Invitations"
          plutôt que son enfant (les deux sections ne sont pas imbriquées l'une
          dans l'autre).
          Dans le contexte accordéon de `GroupsSection.tsx` (Settings), le
          titre englobant "Groupes" (`SectionTitle`) n'est qu'un `<div>` stylé,
          pas un vrai élément de titre — ce `<h2>` y devient donc le premier
          heading réel de la page à cet endroit, ce qui ne crée PAS de saut
          (aucun heading réel ne le précède à sauter). */}
      <h2 style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: '0 0 10px' }}>Membres</h2>

      {viewerRole !== undefined ? (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!canTransfer) return;
              setTransferDialogOpen(true);
            }}
            aria-disabled={!canTransfer}
            aria-describedby={canTransfer ? undefined : 'transfer-ownership-hint'}
            title={
              canTransfer
                ? undefined
                : 'Réservé au propriétaire du groupe, avec au moins un autre membre'
            }
          >
            Transférer la propriété
          </Button>
          {!canTransfer ? (
            <span id="transfer-ownership-hint" className="sr-only">
              Réservé au propriétaire du groupe, avec au moins un autre membre
            </span>
          ) : null}
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
            // Sa propre ligne : suppression complète des actions (pas
            // seulement grisées) — cf. JSDoc en tête de fichier.
            const isSelfRow = member.userId === currentUserId;
            const isPending = pendingUserId === member.userId;
            const roleToggleHintId = `role-toggle-hint-${member.userId}`;
            const removeHintId = `remove-hint-${member.userId}`;

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
                {showActions && !isSelfRow ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (!canManage || isPending) return;
                        handleToggleRole(member);
                      }}
                      aria-disabled={!canManage || isPending}
                      aria-busy={isPending}
                      aria-describedby={canManage || isPending ? undefined : roleToggleHintId}
                      aria-label={isPending ? `${actionLabel} en cours…` : undefined}
                      title={canManage ? undefined : 'Nécessite un rang supérieur à ce membre'}
                    >
                      {isPending ? '…' : actionLabel}
                    </Button>
                    {!canManage && !isPending ? (
                      <span id={roleToggleHintId} className="sr-only">
                        Nécessite un rang supérieur à ce membre
                      </span>
                    ) : null}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (!canManage) return;
                        setRemoveTarget(member);
                      }}
                      aria-disabled={!canManage}
                      aria-describedby={canManage ? undefined : removeHintId}
                      title={canManage ? undefined : 'Nécessite un rang supérieur à ce membre'}
                    >
                      Retirer
                    </Button>
                    {!canManage ? (
                      <span id={removeHintId} className="sr-only">
                        Nécessite un rang supérieur à ce membre
                      </span>
                    ) : null}
                  </>
                ) : null}
                {showActions && isSelfRow ? (
                  viewerRole === 'owner' ? (
                    <span style={{ fontSize: 11, color: NX.fgDim, flexShrink: 0 }}>
                      {transferCandidates.length === 0
                        ? 'Supprime le groupe pour le quitter.'
                        : 'Transfère la propriété avant de quitter.'}
                    </span>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setLeaveDialogOpen(true)}
                    >
                      Quitter le groupe
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <GroupInvitationsSection groupId={groupId} viewerRole={viewerRole} />

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

      {leaveDialogOpen && currentUserId ? (
        <LeaveGroupDialog
          groupId={groupId}
          userId={currentUserId}
          onClose={() => setLeaveDialogOpen(false)}
          onLeft={() => {
            handleMemberRemoved(currentUserId);
            onSelfLeft?.();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Dialogue de transfert de propriété (MAN-181 Phase 2 Task 4) — même registre
 * visuel que `ConfirmGroupActionDialog` (`GroupMenu.tsx`), via le shell
 * partagé `GlassDialogShell` (MAN-201). Deux étapes explicites (choix de la
 * cible puis confirmation) puisque l'action est irréversible et significative
 * pour le viewer, qui perd son rôle de propriétaire.
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
  const ctaSize = useDialogCtaSize();
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
    <GlassDialogShell
      title="Transférer la propriété du groupe"
      onClose={onClose}
      closeDisabled={busy}
    >
      {candidates.length === 0 ? (
        <>
          <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
            Il n'y a personne d'autre dans ce groupe : impossible de transférer la propriété pour
            l'instant.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <Button onClick={onClose} variant="primary" size={ctaSize}>
              Fermer
            </Button>
          </div>
        </>
      ) : !confirming ? (
        <>
          <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
            Choisis le membre qui deviendra propriétaire du groupe. Cette action est irréversible :
            tu deviendras toi-même admin.
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
            <GlassDialogSecondaryButton onClick={onClose}>Annuler</GlassDialogSecondaryButton>
            <Button
              onClick={() => setConfirming(true)}
              disabled={!selected}
              variant="primary"
              size={ctaSize}
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
            <GlassDialogSecondaryButton onClick={() => setConfirming(false)} disabled={busy}>
              Retour
            </GlassDialogSecondaryButton>
            <Button
              onClick={() => void handleConfirm()}
              disabled={busy}
              variant="destructive"
              size={ctaSize}
            >
              {busy ? 'Transfert…' : 'Confirmer le transfert'}
            </Button>
          </div>
        </>
      )}
    </GlassDialogShell>
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
  const ctaSize = useDialogCtaSize();
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
    <GlassDialogShell
      title={`Retirer « ${member.displayName} » du groupe ?`}
      onClose={onClose}
      closeDisabled={busy}
    >
      <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
        Cette personne perdra immédiatement l'accès aux conversations et à l'organisation de ce
        groupe. Elle pourra être réinvitée plus tard si besoin.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <GlassDialogSecondaryButton onClick={onClose} disabled={busy}>
          Annuler
        </GlassDialogSecondaryButton>
        <Button
          onClick={() => void handleConfirm()}
          disabled={busy}
          variant="destructive"
          size={ctaSize}
        >
          {busy ? 'Retrait…' : 'Retirer du groupe'}
        </Button>
      </div>
    </GlassDialogShell>
  );
}

/**
 * Dialogue de confirmation du self-leave (MAN-196) — même registre visuel que
 * `TransferOwnershipDialog`/`RemoveMemberDialog` ci-dessus, même endpoint
 * `useLeaveGroup` (cf. JSDoc de `RemoveMemberDialog`), copie alignée sur
 * `ConfirmGroupActionDialog` (`kind: 'leave'`, `GroupMenu.tsx`) pour rester
 * cohérent d'un endroit à l'autre de l'app.
 *
 * Pas de nom de groupe interpolé dans le titre : contrairement à
 * `RemoveMemberDialog` qui a la cible sous la main (`member.displayName`),
 * ce panel n'a que `groupId` en prop (cf. `GroupMembersPanelProps`) — l'un
 * des deux appelants (`GroupMembersScreen`) ne porte pas non plus le nom du
 * groupe aujourd'hui. Un titre générique évite d'ajouter une prop rien que
 * pour cet affichage.
 *
 * Contrairement à `TransferOwnershipDialog`/`RemoveMemberDialog`, l'échec
 * affiche une erreur inline plutôt que de rester silencieux : cette action
 * est déclenchée par le viewer sur sa propre ligne, potentiellement après
 * que son rôle ou son appartenance a changé entre temps (ex. promu owner par
 * quelqu'un d'autre, ou déjà retiré du groupe, pendant que ce dialog était
 * ouvert). Les deux échecs réalistes sont PERMANENTS, pas transitoires — un
 * retry immédiat échouerait à l'identique — donc le message est branché sur
 * `err.code` plutôt que de prétendre uniformément à un problème passager :
 *  - `PERMISSION_DENIED` (`cannot_remove_owner`, cf.
 *    `backend/src/routes/groups/service.ts`) : le viewer est désormais
 *    owner, il doit transférer la propriété avant de pouvoir quitter.
 *  - `RESOURCE_NOT_FOUND` : le viewer a déjà été retiré du groupe par
 *    ailleurs (kick concurrent) — quitter est déjà un fait accompli.
 * Tout autre cas (réseau, 5xx, etc.) reste le message générique historique.
 */
function LeaveGroupDialog({
  groupId,
  userId,
  onClose,
  onLeft,
}: {
  groupId: string;
  userId: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const leaveGroup = useLeaveGroup();
  const ctaSize = useDialogCtaSize();
  const [error, setError] = useState<string | null>(null);
  const busy = leaveGroup.isPending === true;

  async function handleConfirm() {
    setError(null);
    try {
      await leaveGroup.mutateAsync({ groupId, userId });
      onLeft();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PERMISSION_DENIED') {
        setError(
          'Tu es désormais propriétaire de ce groupe : transfère la propriété avant de le quitter.',
        );
      } else if (err instanceof ApiError && err.code === 'RESOURCE_NOT_FOUND') {
        setError('Tu ne fais plus partie de ce groupe.');
      } else {
        setError("Impossible de quitter le groupe pour l'instant. Réessaie dans un instant.");
      }
    }
  }

  return (
    <GlassDialogShell title="Quitter ce groupe ?" onClose={onClose} closeDisabled={busy}>
      <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
        Tu ne verras plus les conversations ni l'organisation de ce groupe. Tu pourras y revenir
        avec une nouvelle invitation.
      </p>
      {error ? (
        <p style={{ fontSize: 12, color: NX.error, marginTop: 10, lineHeight: 1.4 }}>{error}</p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <GlassDialogSecondaryButton onClick={onClose} disabled={busy}>
          Annuler
        </GlassDialogSecondaryButton>
        <Button
          onClick={() => void handleConfirm()}
          disabled={busy}
          variant="destructive"
          size={ctaSize}
        >
          {busy ? 'Sortie…' : 'Quitter le groupe'}
        </Button>
      </div>
    </GlassDialogShell>
  );
}
