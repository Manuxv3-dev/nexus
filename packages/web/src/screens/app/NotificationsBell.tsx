/**
 * NotificationsBell — icône cloche avec badge unread count + dropdown panel
 * (cf. ADR-023 lot C3).
 *
 * Monté dans AppShell. S'abonne aux notifs via useNotifications + écoute le
 * WS event `notification:created` (relayé par useKillerFeaturesWs qui
 * invalide la query ['notifications']). Le badge compte les unread.
 *
 * UX (modèle Slack/Discord) :
 *  - Icône cloche en haut à droite, avec badge count si unread > 0
 *  - Click → ouvre le dropdown panel en glass (Liquid Glass cf. ADR-021)
 *  - Le panel liste les notifs récentes (50 max), unread visuellement
 *    distinctes (fond + dot). Clic sur une notif → mark as read.
 *  - Bouton "Tout marquer lu" en haut à droite du panel.
 *  - Auto-close si click en dehors.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PhIcon } from '@/components/ui';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationDto,
  type NotificationKind,
} from '@/lib/queries';
import { NX, featureColor, type FeatureKey } from '@/lib/tokens';

export interface NotificationsBellProps {
  /** Callback pour deep-link vers le bon dashboard quand on clique sur une notif. */
  onNavigate?: (groupId: string | null, kind: NotificationKind, sourceId: string | null) => void;
}

export function NotificationsBell({ onNavigate }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const notifsQ = useNotifications();
  const unreadCount = notifsQ.data?.unreadCount ?? 0;

  // Auto-close si click hors du panel.
  // Le panel est en portal vers document.body, donc PAS enfant de wrapperRef.
  // On l'exclut via le data-attribute `data-nexus-notifs-panel` pour éviter
  // de fermer le panel quand on clique sur une notif dedans (sinon le
  // composant est unmounted avant que le onClick de la notif ait pu fire).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      if (target && target.closest('[data-nexus-notifs-panel]')) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // Esc ferme aussi
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: open ? NX.elevated : 'transparent',
          border: 'none',
          borderRadius: NX.radiusMd,
          color: NX.fg,
          cursor: 'pointer',
        }}
      >
        <PhIcon name="bell" size={18} color={NX.fg} />
        {unreadCount > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              background: NX.error,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontVariantNumeric: 'tabular-nums',
              border: `1.5px solid ${NX.bg}`,
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open
        ? createPortal(
            <NotificationsPanel
              anchorRef={wrapperRef}
              notifications={notifsQ.data?.notifications ?? []}
              loading={notifsQ.isLoading}
              unreadCount={unreadCount}
              onClose={() => setOpen(false)}
              onNavigate={(groupId, kind, sourceId) => {
                setOpen(false);
                onNavigate?.(groupId, kind, sourceId);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

// ─────────────────────────── Panel ─────────────────────────────────────

function NotificationsPanel({
  anchorRef,
  notifications,
  loading,
  unreadCount,
  onClose,
  onNavigate,
}: {
  anchorRef: React.RefObject<HTMLDivElement>;
  notifications: NotificationDto[];
  loading: boolean;
  unreadCount: number;
  onClose: () => void;
  onNavigate: (groupId: string | null, kind: NotificationKind, sourceId: string | null) => void;
}) {
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // Position fixed calculée depuis le rect du wrapper (la cloche), pour
  // sortir hors des parents qui auraient overflow:hidden (sidebar AppShell).
  const [pos, setPos] = useState<{ left: number; bottom: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    const recompute = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const PANEL_WIDTH = 380;
      // Sort à droite de la cloche, aligné en bas avec la cloche.
      // Le panel se déploie vers le haut (CSS bottom). Sa height naturelle
      // est limitée par maxH (la place disponible jusqu'au top du viewport).
      const left = Math.min(rect.right + 12, window.innerWidth - PANEL_WIDTH - 8);
      const bottom = Math.max(8, window.innerHeight - rect.bottom);
      const maxH = Math.min(520, window.innerHeight - bottom - 8);
      setPos({ left: Math.max(8, left), bottom, maxH });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [anchorRef]);

  if (!pos) return null;

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      data-nexus-notifs-panel=""
      style={{
        position: 'fixed',
        left: pos.left,
        bottom: pos.bottom,
        width: 380,
        maxHeight: pos.maxH,
        display: 'flex',
        flexDirection: 'column',
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        border: `0.5px solid ${NX.glassBorder}`,
        borderRadius: NX.radiusLg,
        boxShadow: NX.glassShadow,
        zIndex: 100,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `0.5px solid ${NX.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: NX.fg, margin: 0 }}>
            Notifications
          </h3>
          {unreadCount > 0 ? (
            <span style={{ fontSize: 11, color: NX.fgMuted }}>{unreadCount} non lues</span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              style={{
                background: 'transparent',
                border: 'none',
                color: NX.primary,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Tout marquer lu
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'transparent',
              border: 'none',
              color: NX.fgMuted,
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <PhIcon name="x" size={16} color={NX.fgMuted} />
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ padding: 24, fontSize: 12, color: NX.fgDim, textAlign: 'center' }}>
            Chargement…
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <PhIcon name="bell" size={28} color={NX.fgGhost} />
            <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10 }}>
              Pas encore de notifications.
            </div>
            <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 4, lineHeight: 1.4 }}>
              Tu seras notifié des rappels d'events, des dépenses ajoutées,<br />
              des tâches assignées et des sondages à voter.
            </div>
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notif={n}
              onClick={() => {
                if (!n.readAt) markRead.mutate({ notificationId: n.id });
                onNavigate(n.groupId, n.kind, n.sourceId);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Item ──────────────────────────────────────

function NotificationItem({
  notif,
  onClick,
}: {
  notif: NotificationDto;
  onClick: () => void;
}) {
  const isUnread = !notif.readAt;
  const meta = META_BY_KIND[notif.kind];
  const featColor = featureColor[meta.featureKey];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        padding: '10px 16px',
        background: isUnread ? NX.primaryMuted : 'transparent',
        border: 'none',
        borderBottom: `0.5px solid ${NX.border}`,
        cursor: 'pointer',
        textAlign: 'left',
        color: NX.fg,
        position: 'relative',
      }}
    >
      {/* Dot unread */}
      {isUnread ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 6,
            top: 18,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: NX.primary,
          }}
        />
      ) : null}

      {/* Icon feature */}
      <div
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 9,
          background: `${featColor}20`,
          color: featColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PhIcon name={meta.icon} size={16} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: NX.fg, lineHeight: 1.35 }}>
          {renderNotifMessage(notif)}
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>
          {humanAgo(new Date(notif.createdAt))}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────── Mappers ───────────────────────────────────

const META_BY_KIND: Record<NotificationKind, { featureKey: FeatureKey; icon: 'calendarBlank' | 'chartBar' | 'currencyDollar' | 'listChecks' | 'bell' }> = {
  event_reminder: { featureKey: 'events', icon: 'calendarBlank' },
  event_rsvp_requested: { featureKey: 'events', icon: 'calendarBlank' },
  event_rsvp_received: { featureKey: 'events', icon: 'calendarBlank' },
  expense_added: { featureKey: 'expenses', icon: 'currencyDollar' },
  todo_assigned: { featureKey: 'todo', icon: 'listChecks' },
  todo_completed: { featureKey: 'todo', icon: 'listChecks' },
};

function renderNotifMessage(n: NotificationDto): React.ReactNode {
  const p = n.payload as Record<string, unknown>;
  switch (n.kind) {
    case 'event_reminder': {
      const tier = (p.tier as string) === 'h24' ? 'dans 24h' : 'dans 1h';
      return (
        <>
          <strong>{(p.eventTitle as string) ?? 'Un événement'}</strong> commence {tier}.
        </>
      );
    }
    case 'event_rsvp_requested':
      return (
        <>
          <strong>{(p.createdByName as string) ?? 'Quelqu\'un'}</strong> a créé{' '}
          <strong>{(p.eventTitle as string) ?? 'un événement'}</strong>. Tu RSVP ?
        </>
      );
    case 'expense_added': {
      const share = (p.shareCents as number) / 100;
      const desc = (p.description as string) ?? 'une dépense';
      const payer = (p.paidByName as string) ?? 'Quelqu\'un';
      return (
        <>
          <strong>{payer}</strong> a payé <strong>{desc}</strong>. Ta part :{' '}
          <strong>{share.toLocaleString('fr-FR', { style: 'currency', currency: (p.currency as string) ?? 'EUR' })}</strong>.
        </>
      );
    }
    case 'event_rsvp_received': {
      const respName = (p.respondentName as string) ?? "Quelqu'un";
      const value = p.value as string;
      const valueLabel = value === 'yes' ? 'a confirmé' : value === 'maybe' ? 'a répondu peut-être' : 'a décliné';
      return (
        <>
          <strong>{respName}</strong> {valueLabel} pour <strong>{(p.eventTitle as string) ?? 'ton événement'}</strong>.
        </>
      );
    }
    case 'todo_completed': {
      const completer = (p.completedByName as string) ?? "Quelqu'un";
      return (
        <>
          <strong>{completer}</strong> a coché{' '}
          <em style={{ color: NX.fgMuted }}>« {(p.text as string) ?? 'une tâche'} »</em> dans{' '}
          <strong>{(p.listTitle as string) ?? 'une liste'}</strong>.
        </>
      );
    }
    case 'todo_assigned':
      return (
        <>
          <strong>{(p.assignedByName as string) ?? 'Quelqu\'un'}</strong> t'a assigné{' '}
          <em style={{ color: NX.fgMuted }}>« {(p.text as string) ?? 'une tâche'} »</em> dans{' '}
          <strong>{(p.listTitle as string) ?? 'une liste'}</strong>.
        </>
      );
  }
}

// ─────────────────────────── Helpers ────────────────────────────────────

function humanAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
