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

import { AsyncSection, Button, PhIcon } from '@/components/ui';
import {
  useClearAllNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationDto,
  type NotificationKind,
} from '@/lib/queries';
import { NX, featureColor, type FeatureKey } from '@/lib/tokens';
import { cn } from '@/lib/utils';

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
      if (wrapperRef.current?.contains(target)) return;
      if (target?.closest('[data-nexus-notifs-panel]')) return;
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
      {/* Migré vers le composant Button partagé (MAN-111 Task 3) : relief au
          survol/focus cohérent avec le reste du shell, comportement onClick
          et badge unread inchangés. `relative` restauré via className pour
          ancrer le badge (position absolute) sur ce bouton précisément. */}
      <Button
        type="button"
        variant="icon"
        size="icon"
        // `bg-nx-elevated` quand le panel est ouvert : le <button> brut
        // portait ce feedback visuel en inline style, la migration ne doit pas
        // le perdre (aria-expanded ne couvre que les techno d'assistance).
        className={cn('relative h-9 w-9', open && 'bg-nx-elevated')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
      >
        <PhIcon name="bell" size={18} />
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
      </Button>

      {open
        ? createPortal(
            <NotificationsPanel
              anchorRef={wrapperRef}
              notifications={notifsQ.data?.notifications ?? []}
              // MAN-244 : `isPending` et pas `isLoading` (query désactivable), et
              // `isError` remonté pour ne plus afficher « Pas encore de
              // notifications » quand la requête a échoué.
              isPending={notifsQ.isPending}
              isError={notifsQ.isError}
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
  isPending,
  isError,
  unreadCount,
  onClose,
  onNavigate,
}: {
  anchorRef: React.RefObject<HTMLDivElement>;
  notifications: NotificationDto[];
  isPending: boolean;
  isError: boolean;
  unreadCount: number;
  onClose: () => void;
  onNavigate: (groupId: string | null, kind: NotificationKind, sourceId: string | null) => void;
}) {
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const clearAll = useClearAllNotifications();

  // Position fixed calculée depuis le rect du wrapper (la cloche).
  //
  // Contrainte critique post-2026-05-05 : la zone main contient parfois une
  // webview Tauri (Discord, WhatsApp, etc.) qui est une couche native
  // s'affichant au-dessus du HTML quoi qu'il arrive (z-index inopérant). Le
  // panel doit donc rester strictement dans la zone du blade (sidebar) pour
  // ne pas être occulté.
  //
  // Stratégie : largeur = largeur du blade − marges, ancrée à gauche du
  // viewport. Le panel se déploie vers le HAUT (la cloche est en bas du
  // blade) ou vers le BAS si la cloche est dans la moitié haute (futur).
  const [pos, setPos] = useState<
    null | ({ left: number; width: number; maxH: number } & ({ top: number } | { bottom: number }))
  >(null);
  useLayoutEffect(() => {
    const recompute = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const GAP = 8;
      const PADDING = 8;
      // Le blade est l'ancestor <aside> du wrapper. On lit ses bounds pour
      // connaître la largeur exacte (le user peut l'avoir resizé via le
      // handle, cf. BLADE_WIDTH_MIN/MAX dans AppShell).
      const blade = anchorRef.current?.closest('aside');
      const bladeRect = blade?.getBoundingClientRect();
      const left = bladeRect ? bladeRect.left + PADDING : PADDING;
      const width = bladeRect ? Math.max(180, bladeRect.width - PADDING * 2) : 240;
      // Détection : si la cloche est dans la moitié haute, panel vers le bas.
      const openDownward = rect.top < window.innerHeight / 2;
      if (openDownward) {
        const top = Math.min(rect.bottom + GAP, window.innerHeight - 100);
        const maxH = Math.min(520, window.innerHeight - top - PADDING);
        setPos({ left, width, top, maxH });
      } else {
        // Panel se déploie vers le haut depuis JUSTE AU-DESSUS de la cloche.
        const bottom = Math.max(PADDING, window.innerHeight - rect.top + GAP);
        const maxH = Math.min(520, window.innerHeight - bottom - PADDING);
        setPos({ left, width, bottom, maxH });
      }
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
        ...('top' in pos ? { top: pos.top } : { bottom: pos.bottom }),
        width: pos.width,
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: NX.fg, margin: 0 }}>Notifications</h3>
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
          {notifications.length > 0 ? (
            <button
              type="button"
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending}
              title="Supprimer toutes les notifications"
              style={{
                background: 'transparent',
                border: 'none',
                color: NX.fgMuted,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Vider
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
        {/* MAN-244 : c'est le seul des huit sites où le vide se décide
            réellement ici — d'où l'usage d'`<AsyncSection>`, qui rend la branche
            `error` obligatoire au niveau du type. Avant, un échec réseau
            affichait « Pas encore de notifications ». */}
        <AsyncSection
          query={{ isPending, isError, data: notifications }}
          pending={
            <div style={{ padding: 24, fontSize: 12, color: NX.fgDim, textAlign: 'center' }}>
              Chargement…
            </div>
          }
          error={
            <div style={{ padding: 32, textAlign: 'center' }}>
              {/* Pas d'icône « warning » dans le set (cf. ICON_PATHS) : la même
                  cloche en rouge, avec une copie distincte, suffit à séparer
                  l'échec de l'état vide. */}
              <PhIcon name="bell" size={28} color={NX.error} />
              <div style={{ fontSize: 13, color: NX.error, marginTop: 10 }}>
                Impossible de charger tes notifications.
              </div>
            </div>
          }
          empty={
            <div style={{ padding: 32, textAlign: 'center' }}>
              <PhIcon name="bell" size={28} color={NX.fgGhost} />
              <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10 }}>
                Pas encore de notifications.
              </div>
              <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 4, lineHeight: 1.4 }}>
                Tu seras notifié des rappels d'events, des dépenses ajoutées,
                <br />
                des tâches assignées et des sondages à voter.
              </div>
            </div>
          }
          isEmpty={(items) => items.length === 0}
        >
          {(items) =>
            items.map((n) => (
              <NotificationItem
                key={n.id}
                notif={n}
                onClick={() => {
                  if (!n.readAt) markRead.mutate({ notificationId: n.id });
                  onNavigate(n.groupId, n.kind, n.sourceId);
                }}
              />
            ))
          }
        </AsyncSection>
      </div>
    </div>
  );
}

// ─────────────────────────── Item ──────────────────────────────────────

function NotificationItem({ notif, onClick }: { notif: NotificationDto; onClick: () => void }) {
  const isUnread = !notif.readAt;
  // META_BY_KIND est `Record<NotificationKind, NotifMeta>` exhaustif → l'accès
  // est garanti à runtime, mais `noUncheckedIndexedAccess` impose un fallback.
  const meta = META_BY_KIND[notif.kind] ?? {
    icon: 'bell' as const,
    featureKey: 'events',
  };
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

const META_BY_KIND: Record<
  NotificationKind,
  {
    featureKey: FeatureKey;
    icon: 'calendarBlank' | 'chartBar' | 'currencyDollar' | 'listChecks' | 'bell';
  }
> = {
  event_reminder: { featureKey: 'events', icon: 'calendarBlank' },
  event_rsvp_requested: { featureKey: 'events', icon: 'calendarBlank' },
  event_rsvp_received: { featureKey: 'events', icon: 'calendarBlank' },
  expense_added: { featureKey: 'expenses', icon: 'currencyDollar' },
  todo_assigned: { featureKey: 'todo', icon: 'listChecks' },
  todo_completed: { featureKey: 'todo', icon: 'listChecks' },
  // Pas de feature/couleur dédiée : ce n'est pas rattaché à un panel
  // events/polls/expenses/todo, juste une info de membership de groupe.
  member_removed: { featureKey: 'events', icon: 'bell' },
};

function renderNotifMessage(n: NotificationDto): React.ReactNode {
  const p = n.payload;
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
          <strong>{(p.createdByName as string) ?? "Quelqu'un"}</strong> a créé{' '}
          <strong>{(p.eventTitle as string) ?? 'un événement'}</strong>. Tu RSVP ?
        </>
      );
    case 'expense_added': {
      const share = (p.shareCents as number) / 100;
      const desc = (p.description as string) ?? 'une dépense';
      const payer = (p.paidByName as string) ?? "Quelqu'un";
      return (
        <>
          <strong>{payer}</strong> a payé <strong>{desc}</strong>. Ta part :{' '}
          <strong>
            {share.toLocaleString('fr-FR', {
              style: 'currency',
              currency: (p.currency as string) ?? 'EUR',
            })}
          </strong>
          .
        </>
      );
    }
    case 'event_rsvp_received': {
      const respName = (p.respondentName as string) ?? "Quelqu'un";
      const value = p.value as string;
      const valueLabel =
        value === 'yes' ? 'a confirmé' : value === 'maybe' ? 'a répondu peut-être' : 'a décliné';
      return (
        <>
          <strong>{respName}</strong> {valueLabel} pour{' '}
          <strong>{(p.eventTitle as string) ?? 'ton événement'}</strong>.
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
          <strong>{(p.assignedByName as string) ?? "Quelqu'un"}</strong> t'a assigné{' '}
          <em style={{ color: NX.fgMuted }}>« {(p.text as string) ?? 'une tâche'} »</em> dans{' '}
          <strong>{(p.listTitle as string) ?? 'une liste'}</strong>.
        </>
      );
    case 'member_removed':
      return <>Tu as été retiré d'un groupe.</>;
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
