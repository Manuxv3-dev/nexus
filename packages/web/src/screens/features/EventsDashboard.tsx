/**
 * Dashboard Events — vue panel rendue par AppShell pour `pane === 'event'`.
 *
 * Layout 2 colonnes : calendrier mensuel (gauche) + liste cards à venir
 * (droite), modal détail/création par dessus. Cf. J5b #38.
 */
import { useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

import { useAuth } from '@/lib/auth';
import { useEvents, useGroups, type EventDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { EventModal } from './events/EventModal';

type Filter = 'upcoming' | 'mine' | 'past';

export function EventsDashboard() {
  const { user } = useAuth();
  const groupsQ = useGroups();
  // Le groupe actif vient du store partagé avec AppShell ; pour rester
  // simple en J5b on prend le premier groupe (l'AppShell garde ce contrat).
  // J5c branchera un store activeGroupId dédié.
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('upcoming');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  // On ne stocke que l'ID — on lookup `eventsList` à chaque render pour
  // que la modal suive automatiquement les re-fetch après RSVP/edit.
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view' | 'edit'; eventId: string } | null
  >(null);

  const eventsQ = useEvents(
    activeGroupId,
    filter === 'past' ? { when: 'past' } : { when: 'upcoming' },
  );
  const allEvents = eventsQ.data ?? [];

  const filteredEvents = useMemo(() => {
    if (filter !== 'mine' || !user) return allEvents;
    return allEvents.filter((e) => !e.rsvps.some((r) => r.userId === user.id));
  }, [allEvents, filter, user]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventDto[]>();
    for (const e of filteredEvents) {
      const key = isoDay(new Date(e.startsAt));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [filteredEvents]);

  const dayModifiers = useMemo(() => {
    const days: Date[] = [];
    for (const e of filteredEvents) {
      days.push(new Date(e.startsAt));
    }
    return { hasEvent: days };
  }, [filteredEvents]);

  const eventsForSelectedDay = selectedDate
    ? eventsByDay.get(isoDay(selectedDate)) ?? []
    : filteredEvents;

  const openEvent =
    modal?.mode === 'view' || modal?.mode === 'edit'
      ? allEvents.find((e) => e.id === modal.eventId)
      : undefined;

  return (
    <FeatureShell
      iconName="calendarBlank"
      iconColor={NX.featEvents}
      iconBg={NX.featEventsBg}
      title="Événements"
      subtitle={`${allEvents.length} ${filter === 'past' ? 'passés' : 'à venir'}`}
      primaryAction={{
        label: 'Nouvel événement',
        onClick: () => {
          if (!activeGroupId) return;
          setModal({ mode: 'create' });
        },
      }}
      filters={
        <>
          <FilterChip
            label="À venir"
            active={filter === 'upcoming'}
            onClick={() => setFilter('upcoming')}
          />
          <FilterChip
            label="Mes RSVP en attente"
            active={filter === 'mine'}
            onClick={() => setFilter('mine')}
          />
          <FilterChip
            label="Passés"
            active={filter === 'past'}
            onClick={() => setFilter('past')}
          />
          <FilterDivider />
          {selectedDate ? (
            <FilterChip
              label={`Jour ${selectedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
              active
              onClick={() => setSelectedDate(undefined)}
            />
          ) : null}
        </>
      }
    >
      {!activeGroupId ? (
        <Placeholder
          title="Aucun groupe actif"
          description="Sélectionne un groupe dans le rail de gauche pour voir ses événements."
        />
      ) : eventsQ.isLoading ? (
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 320px) 1fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* Calendrier */}
          <div
            style={{
              background: NX.surface,
              border: `0.5px solid ${NX.border}`,
              borderRadius: NX.radius,
              padding: 16,
            }}
          >
            <CalendarStyles />
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              modifiers={dayModifiers}
              modifiersClassNames={{ hasEvent: 'rdp-has-event' }}
              showOutsideDays
              weekStartsOn={1}
            />
          </div>

          {/* Liste cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {eventsForSelectedDay.length === 0 ? (
              <Placeholder
                title={
                  selectedDate
                    ? `Rien le ${selectedDate.toLocaleDateString('fr-FR')}`
                    : filter === 'past'
                      ? 'Pas d’événements passés'
                      : 'Pas encore d’événements'
                }
                description={
                  filter === 'past'
                    ? 'Les événements passés apparaîtront ici.'
                    : 'Crée le premier avec le bouton « Nouvel événement ».'
                }
              />
            ) : (
              eventsForSelectedDay.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  onOpen={() => setModal({ mode: 'view', eventId: e.id })}
                />
              ))
            )}
          </div>
        </div>
      )}

      {modal && activeGroupId ? (
        modal.mode === 'create' ? (
          <EventModal
            mode="create"
            groupId={activeGroupId}
            onClose={() => setModal(null)}
            onSwitchToEdit={() => null}
          />
        ) : openEvent ? (
          <EventModal
            mode={modal.mode}
            groupId={activeGroupId}
            event={openEvent}
            canEdit={user ? openEvent.createdBy === user.id : false}
            onClose={() => setModal(null)}
            onSwitchToEdit={() => setModal({ mode: 'edit', eventId: openEvent.id })}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
}

// ─────────────────────────── Helpers ────────────────────────────────────

function isoDay(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─────────────────────────── Card ───────────────────────────────────────

function EventCard({ event, onOpen }: { event: EventDto; onOpen: () => void }) {
  const { user } = useAuth();
  const myRsvp = user ? event.rsvps.find((r) => r.userId === user.id)?.value ?? null : null;
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of event.rsvps) counts[r.value] += 1;
  const date = new Date(event.startsAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: NX.surface,
        border: `0.5px solid ${myRsvp === null ? NX.warning : NX.border}`,
        borderRadius: NX.radius,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        color: NX.fg,
        transition: 'all 150ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = NX.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = myRsvp === null ? NX.warning : NX.border;
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{event.title}</div>
        {myRsvp === null ? (
          <span style={{ fontSize: 10, color: NX.warning }}>À répondre</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: NX.fgMuted, marginTop: 4 }}>
        {date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
        {' · '}
        {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        {event.location ? ` · ${event.location}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Pill count={counts.yes} label="oui" color={NX.success} />
        <Pill count={counts.maybe} label="?" color={NX.warning} />
        <Pill count={counts.no} label="non" color={NX.error} />
        {event.tags.slice(0, 2).map((t) => (
          <span
            key={t}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              background: 'transparent',
              border: `0.5px solid ${NX.border}`,
              borderRadius: NX.radiusPill,
              color: NX.fgDim,
            }}
          >
            #{t}
          </span>
        ))}
      </div>
    </button>
  );
}

function Pill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: NX.radiusPill,
        background: 'transparent',
        border: `0.5px solid ${color}`,
        color,
        fontWeight: 500,
      }}
    >
      {count} {label}
    </span>
  );
}

// ─────────────────────────── Style overrides DayPicker ──────────────────

function CalendarStyles() {
  // react-day-picker fournit son CSS de base ; on override avec les tokens
  // Nexus via un <style scoped manuellement>. Inline pour rester local au
  // composant (pas de pollution globale).
  return (
    <style>{`
      .rdp-root { --rdp-accent-color: ${NX.featEvents}; --rdp-accent-background-color: ${NX.featEventsBg}; }
      .rdp-root, .rdp-root * { color: ${NX.fg}; font-family: inherit; font-size: 13px; }
      .rdp-month_caption { color: ${NX.fg}; font-weight: 500; }
      .rdp-weekday { color: ${NX.fgDim}; font-weight: 400; font-size: 11px; }
      .rdp-day { color: ${NX.fgMuted}; }
      .rdp-day_button:hover { background: ${NX.elevated}; }
      .rdp-today .rdp-day_button { color: ${NX.featEvents}; font-weight: 500; }
      .rdp-selected .rdp-day_button { background: ${NX.featEvents}; color: ${NX.bg}; }
      .rdp-outside { color: ${NX.fgGhost}; }
      .rdp-has-event:not(.rdp-selected) .rdp-day_button {
        position: relative;
        color: ${NX.fg};
      }
      .rdp-has-event:not(.rdp-selected) .rdp-day_button::after {
        content: '';
        position: absolute;
        bottom: 4px;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: ${NX.featEvents};
      }
      .rdp-button_previous, .rdp-button_next { color: ${NX.fgMuted}; }
      .rdp-button_previous:hover, .rdp-button_next:hover { color: ${NX.fg}; }
    `}</style>
  );
}
