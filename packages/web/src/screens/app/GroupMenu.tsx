/**
 * Menu kebab du groupe — affiché à côté du nom du groupe dans la 2e
 * colonne de l'AppShell (et le header mobile).
 *
 * Affiche selon le rôle du membre courant :
 *  - owner   → "Supprimer le groupe" (cascade côté backend)
 *  - autre   → "Quitter le groupe"
 *
 * Confirmation modale obligatoire dans les deux cas.
 */
import { useEffect, useRef, useState } from 'react';

import { PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useDeleteGroup, useLeaveGroup, type Group } from '@/lib/queries';
import { NX } from '@/lib/tokens';

export interface GroupMenuProps {
  group: Group;
}

export function GroupMenu({ group }: GroupMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<null | 'leave' | 'delete'>(null);
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
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Options du groupe"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: open ? NX.elevated : 'transparent',
          border: 'none',
          color: NX.fgMuted,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = NX.elevated;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent';
        }}
      >
        <PhIcon name="dotsThree" size={16} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 8,
            background: NX.elevated,
            border: `0.5px solid ${NX.borderHover}`,
            borderRadius: NX.radiusSm,
            padding: 4,
            minWidth: 200,
            zIndex: 50,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmKind(isOwner ? 'delete' : 'leave');
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              color: NX.error,
              fontSize: 13,
              borderRadius: NX.radiusXs,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
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
    </>
  );
}

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
      'Tu ne verras plus les conversations ni l\'organisation de ce groupe. Tu pourras y revenir avec une nouvelle invitation.',
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
        background: 'rgba(0,0,0,0.6)',
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
          background: NX.elevated,
          borderRadius: NX.radius,
          padding: 24,
          maxWidth: 440,
          width: '100%',
          border: `1px solid ${NX.border}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>
          {titles[kind]}
        </h2>
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
