/**
 * Menu kebab du groupe — affiché à côté du nom du groupe dans la 2e
 * colonne de l'AppShell (et le header mobile).
 *
 * Items selon le rôle du membre courant :
 *  - admin+  → "Inviter quelqu'un" (génère un lien d'invitation)
 *  - owner   → "Supprimer le groupe" (cascade)
 *  - autres  → "Quitter le groupe"
 *
 * Confirmation modale pour les actions destructives.
 */
import { useNavigate } from '@tanstack/react-router';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button, CopyLinkButton, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  useCreateInvitation,
  useDeleteGroup,
  useLeaveGroup,
  type Group,
  type InvitationDto,
} from '@/lib/queries';
import { NX } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export interface GroupMenuProps {
  group: Group;
}

export function GroupMenu({ group }: GroupMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<null | 'leave' | 'delete'>(null);
  // null = fermée ; loading = mutation en cours ; ready = lien prêt ; error = message
  const [inviteState, setInviteState] = useState<
    | null
    | { state: 'loading' }
    | { state: 'ready'; invitation: InvitationDto }
    | { state: 'error'; message: string }
  >(null);
  const [idCopied, setIdCopied] = useState(false);
  const createInvitation = useCreateInvitation();

  function copyGroupId() {
    void navigator.clipboard.writeText(group.id);
    setIdCopied(true);
    // Feedback visuel ~1s puis on ferme le menu pour éviter de polluer l'UI.
    window.setTimeout(() => {
      setIdCopied(false);
      setOpen(false);
    }, 1000);
  }

  async function startInvite() {
    setOpen(false);
    setInviteState({ state: 'loading' });
    try {
      const inv = await createInvitation.mutateAsync({ groupId: group.id });
      setInviteState({ state: 'ready', invitation: inv });
    } catch (err) {
      setInviteState({
        state: 'error',
        message: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    }
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside : ferme le dropdown.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const isOwner = group.role === 'owner';

  return (
    <>
      {/* Migré vers le composant Button partagé (MAN-111 Task 3) : le kebab
          est précisément la cible du variant `icon` du DS (cf. Button.tsx).
          Le survol et l'état ouvert passent par des classes (plus de mutation
          impérative du style dans onMouseEnter/onMouseLeave), et le `style`
          inline traverse Button tel quel — la profondeur visuelle ajoutée en
          Task 2 survit donc à la migration. */}
      <Button
        ref={buttonRef}
        type="button"
        variant="icon"
        size="icon"
        // `cn` (tailwind-merge) résout les conflits en faveur du className
        // local : h-7/w-7 remplacent le h-10/w-10 de size="icon", et
        // bg-nx-elevated remplace bg-card quand le menu est ouvert.
        className={cn('h-7 w-7 shrink-0', open && 'bg-nx-elevated')}
        // Profondeur visuelle discrète (MAN-111 Task 2) : même registre que
        // le reste du shell (cf. TitleBar). Reste subtil (shadowXs) pour ne
        // pas surcharger un bouton icône minuscule.
        style={{ boxShadow: NX.shadowXs }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Options du groupe"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PhIcon name="dotsThree" size={16} />
      </Button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 8,
            background: NX.glassBg,
            backdropFilter: NX.glassBlur,
            WebkitBackdropFilter: NX.glassBlur,
            border: `0.5px solid ${NX.glassBorder}`,
            borderRadius: NX.radiusSm,
            padding: 4,
            minWidth: 200,
            zIndex: 50,
            boxShadow: NX.glassShadow,
          }}
        >
          {/* tous les rôles → copier l'ID du groupe (utile pour qu'un ami
              entre l'ID lors de la création de compte) */}
          <button
            type="button"
            role="menuitem"
            onClick={copyGroupId}
            style={menuItemStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NX.primaryMuted;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <PhIcon name={idCopied ? 'check' : 'copy'} size={14} />
            {idCopied ? 'ID copié !' : "Copier l'ID du groupe"}
          </button>

          {/* admin+ → inviter */}
          {group.role === 'owner' || group.role === 'admin' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void startInvite()}
              style={menuItemStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = NX.primaryMuted;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <PhIcon name="link" size={14} />
              Inviter quelqu'un
            </button>
          ) : null}

          {/* tous les rôles → voir les membres (MAN-180 Phase 1 Task 4).
              La visibilité des actions promouvoir/rétrograder est gérée
              dans l'écran lui-même selon le rôle du viewer. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/groups/$groupId/members', params: { groupId: group.id } });
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NX.primaryMuted;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <PhIcon name="users" size={14} />
            Membres du groupe
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmKind(isOwner ? 'delete' : 'leave');
            }}
            style={{ ...menuItemStyle, color: NX.error }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NX.errorBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <PhIcon name={isOwner ? 'x' : 'signOut'} size={14} />
            {isOwner ? 'Supprimer le groupe' : 'Quitter le groupe'}
          </button>
        </div>
      ) : null}

      {confirmKind ? (
        <ConfirmGroupActionDialog
          group={group}
          kind={confirmKind}
          onClose={() => setConfirmKind(null)}
        />
      ) : null}

      {inviteState ? (
        <InviteDialog group={group} state={inviteState} onClose={() => setInviteState(null)} />
      ) : null}
    </>
  );
}

const menuItemStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  color: NX.fg,
  fontSize: 13,
  borderRadius: NX.radiusXs,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

// ─────────────────────────── Dialog ─────────────────────────────────────

function ConfirmGroupActionDialog({
  group,
  kind,
  onClose,
}: {
  group: Group;
  kind: 'leave' | 'delete';
  onClose: () => void;
}) {
  const { user } = useAuth();
  const deleteMut = useDeleteGroup();
  const leaveMut = useLeaveGroup();
  const busy = deleteMut.isPending === true || leaveMut.isPending === true;

  const handleConfirm = async () => {
    try {
      if (kind === 'delete') {
        await deleteMut.mutateAsync(group.id);
      } else if (user) {
        await leaveMut.mutateAsync({ groupId: group.id, userId: user.id });
      }
      onClose();
    } catch {
      // L'erreur est déjà loggée par useMutation ; on garde le dialog ouvert
      // pour permettre un retry manuel.
    }
  };

  const titles = {
    delete: `Supprimer "${group.name}" ?`,
    leave: `Quitter "${group.name}" ?`,
  };
  const descriptions = {
    delete:
      'Cette action est irréversible. Toutes les conversations bridgées, événements, sondages, dépenses et listes seront supprimés. Les sessions Discord/WhatsApp/Messenger seront déconnectées.',
    leave:
      "Tu ne verras plus les conversations ni l'organisation de ce groupe. Tu pourras y revenir avec une nouvelle invitation.",
  };
  const ctaLabels = {
    delete: busy ? 'Suppression…' : 'Supprimer définitivement',
    leave: busy ? 'Sortie…' : 'Quitter le groupe',
  };

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
        <h2 style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>{titles[kind]}</h2>
        <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
          {descriptions[kind]}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '8px 18px',
              borderRadius: NX.radiusPill,
              background: 'transparent',
              color: NX.fgMuted,
              border: `1px solid ${NX.border}`,
              fontSize: 13,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            style={{
              padding: '8px 18px',
              borderRadius: NX.radiusPill,
              background: NX.error,
              color: '#1a0606',
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {ctaLabels[kind]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── InviteDialog ───────────────────────────────

type InviteDialogState =
  | { state: 'loading' }
  | { state: 'ready'; invitation: InvitationDto }
  | { state: 'error'; message: string };

function InviteDialog({
  group,
  state: dialogState,
  onClose,
}: {
  group: Group;
  state: InviteDialogState;
  onClose: () => void;
}) {
  const invitation = dialogState.state === 'ready' ? dialogState.invitation : null;
  const errorMsg = dialogState.state === 'error' ? dialogState.message : null;

  const link = invitation ? `${window.location.origin}/invite/${invitation.slug}` : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
          maxWidth: 480,
          width: '100%',
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.glassShadow,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>
          Inviter quelqu'un dans « {group.name} »
        </h2>
        <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
          Partage ce lien avec les personnes que tu veux inviter. Elles rejoindront automatiquement
          le groupe en se connectant.
        </p>

        {dialogState.state === 'loading' ? (
          <div style={{ marginTop: 18, color: NX.fgMuted, fontSize: 13 }}>Génération du lien…</div>
        ) : invitation ? (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                background: NX.surface,
                border: `0.5px solid ${NX.border}`,
                borderRadius: NX.radiusSm,
                padding: '10px 12px',
                alignItems: 'center',
              }}
            >
              <code
                style={{
                  flex: 1,
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
            </div>
            <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 8 }}>
              {invitation.maxUses
                ? `Jusqu'à ${invitation.maxUses} utilisations`
                : 'Utilisations illimitées'}
              {invitation.expiresAt
                ? ` · expire le ${new Date(invitation.expiresAt).toLocaleDateString('fr-FR')}`
                : " · pas d'expiration"}
            </div>
          </div>
        ) : null}

        {errorMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: NX.errorBg,
              color: NX.error,
              borderRadius: NX.radiusSm,
              fontSize: 12,
              wordBreak: 'break-word',
            }}
          >
            {errorMsg}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <Button onClick={onClose} variant="primary" size="sm">
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
