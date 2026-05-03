/**
 * Dashboard Events — refonte structurelle (cf. ADR-021 + bundle HTML
 * 08-events-dashboard-desktop.html, J5c).
 *
 * Layout interne au panel main de l'AppShell :
 *  - Main (1fr) : Hero next event + countdown + RSVP donut, stats row,
 *    grid calendar+upcoming list, past list (filtre)
 *  - Right rail (340px ≥1280px) : activity feed + quick create
 *
 * Le sidebar group context est fourni par AppShell (GroupsRail + ChannelsPane),
 * pas dupliqué ici.
 *
 * Note IA : composants Suggestions Nexus du bundle HTML mis de côté
 * (cf. brief 2026-05-03 "tu ne tiendras pas compte des composants liés à
 * la feature IA"). On ajoute Quick Create à la place.
 */
import { useEffect, useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useEvents, useGroupMembers, useGroups, type EventDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';
import { EventModal } from './events/EventModal';

type Filter = 'upcoming' | 'mine' | 'past';

export function EventsDashboard() {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  const activeGroupId = groups[0]?.id;

  const [filter, setFilter] = useState<Filter>('upcoming');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view' | 'edit'; eventId: string } | null
  >(null);

  const upcomingQ = useEvents(activeGroupId, { when: 'upcoming' });
  const pastQ = useEvents(activeGroupId, { when: 'past' });
  const upcoming = upcomingQ.data ?? [];
  const past = pastQ.data ?? [];

  const allEvents = filter === 'past' ? past : upcoming;
  const filteredEvents = useMemo(() => {
    if (filter !== 'mine' || !user) return allEvents;
    return allEvents.filter((e) => !e.rsvps.some((r) => r.userId === user.id));
  }, [allEvents, filter, user]);

  const nextEvent = upcoming[0];

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

  const dayModifiers = useMemo(
    () => ({ hasEvent: filteredEvents.map((e) => new Date(e.startsAt)) }),
    [filteredEvents],
  );

  const eventsForSelectedDay = selectedDate
    ? eventsByDay.get(isoDay(selectedDate)) ?? []
    : filteredEvents;

  const openEvent =
    modal?.mode === 'view' || modal?.mode === 'edit'
      ? upcoming.concat(past).find((e) => e.id === modal.eventId)
      : undefined;

  return (
    <FeatureShell
      iconName="calendarBlank"
      iconColor={NX.featEvents}
      iconBg={NX.featEventsBg}
      title="Événements"
      subtitle={`${upcoming.length} à venir · ${past.length} passés`}
      primaryAction={{
        label: 'Nouvel événement',
        onClick: () => activeGroupId && setModal({ mode: 'create' }),
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
          <FilterChip label="Passés" active={filter === 'past'} onClick={() => setFilter('past')} />
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
      ) : upcomingQ.isLoading ? (
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : (
        <div style={dashLayout}>
          {/* MAIN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {nextEvent && filter === 'upcoming' ? (
              <NextEventHero event={nextEvent} onOpen={() => setModal({ mode: 'view', eventId: nextEvent.id })} />
            ) : null}

            <StatsRow upcoming={upcoming} past={past} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
                gap: 20,
                alignItems: 'start',
              }}
            >
              {/* Calendar */}
              <div
                style={{
                  background: NX.surface,
                  border: `0.5px solid ${NX.border}`,
                  borderRadius: NX.radiusLg,
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

              {/* Upcoming list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                <SectionHeader
                  title={selectedDate ? `Événements du ${selectedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : filter === 'past' ? 'Événements passés' : 'Événements à venir'}
                  count={eventsForSelectedDay.length}
                />
                {eventsForSelectedDay.length === 0 ? (
                  <Placeholder
                    title={
                      selectedDate
                        ? `Rien le ${selectedDate.toLocaleDateString('fr-FR')}`
                        : filter === 'past'
                          ? 'Pas d’événements passés'
                          : 'Pas encore d’événements'
                    }
                    description="Crée le premier avec « Nouvel événement »."
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
          </div>

          {/* RIGHT RAIL */}
          <div style={rightRailStyle}>
            <ActivityFeed events={upcoming} userId={user?.id} groupId={activeGroupId} />
            <QuickCreate onCreate={() => activeGroupId && setModal({ mode: 'create' })} />
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

// ─────────────────────────── Layout helpers ────────────────────────────

const dashLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 340px',
  gap: 20,
  alignItems: 'start',
};

const rightRailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  position: 'sticky',
  top: 16,
};

// ─────────────────────────── Hero ──────────────────────────────────────

function NextEventHero({ event, onOpen }: { event: EventDto; onOpen: () => void }) {
  const date = new Date(event.startsAt);
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of event.rsvps) counts[r.value] += 1;
  const totalAnswered = counts.yes + counts.maybe + counts.no;
  const cd = useCountdown(date);

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${NX.featEventsBg} 0%, transparent 80%), ${NX.surface}`,
        border: `0.5px solid ${NX.featEvents}33`,
        borderRadius: NX.radiusXl,
        padding: 24,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 24,
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: NX.featEvents,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Prochain · {humanRelative(date)}
        </div>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: NX.fg,
            margin: 0,
            marginBottom: 12,
            lineHeight: 1.15,
          }}
        >
          {event.title}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14, fontSize: 13, color: NX.fgMuted }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <PhIcon name="calendarBlank" size={14} color={NX.fgMuted} />
            {date.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          </span>
          {event.location ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <PhIcon name="mapPin" size={14} color={NX.fgMuted} />
              {event.location}
            </span>
          ) : null}
        </div>

        {/* Countdown */}
        {cd ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <CountdownBlock value={cd.d} label="Jours" />
            <CountdownBlock value={cd.h} label="Heures" />
            <CountdownBlock value={cd.m} label="Minutes" />
            <CountdownBlock value={cd.s} label="Secondes" />
          </div>
        ) : null}

        <button
          type="button"
          onClick={onOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: NX.featEvents,
            color: '#fff',
            border: 'none',
            borderRadius: NX.radiusPill,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Voir l'événement <PhIcon name="arrowRight" size={14} color="#fff" />
        </button>
      </div>

      {/* RSVP donut */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <RsvpDonut yes={counts.yes} maybe={counts.maybe} total={Math.max(totalAnswered, event.rsvps.length, 1)} />
        <div style={{ fontSize: 11, color: NX.fgDim, textAlign: 'center' }}>
          <div><span style={{ color: NX.success, fontWeight: 600 }}>{counts.yes}</span> oui · <span style={{ color: NX.warning, fontWeight: 600 }}>{counts.maybe}</span> peut-être</div>
          {counts.no > 0 ? <div style={{ color: NX.fgGhost }}>{counts.no} non</div> : null}
        </div>
      </div>
    </div>
  );
}

function CountdownBlock({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        background: NX.elevated,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusMd,
        padding: '10px 12px',
        minWidth: 56,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: NX.fg, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value.toString().padStart(2, '0')}
      </div>
      <div style={{ fontSize: 9, textTransform: 'uppercase', color: NX.fgDim, letterSpacing: '0.08em', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

function RsvpDonut({ yes, maybe, total }: { yes: number; maybe: number; total: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const yesArc = (yes / total) * c;
  const maybeArc = (maybe / total) * c;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} fill="none" stroke={NX.border} strokeWidth="10" />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke={NX.success} strokeWidth="10"
        strokeDasharray={`${yesArc} ${c}`} transform="rotate(-90 48 48)" strokeLinecap="round"
      />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke={NX.warning} strokeWidth="10"
        strokeDasharray={`${maybeArc} ${c}`} strokeDashoffset={-yesArc}
        transform="rotate(-90 48 48)" strokeLinecap="round"
      />
      <text x="48" y="52" textAnchor="middle" fontSize="18" fontWeight="700" fill={NX.fg}>
        {yes + maybe}
      </text>
      <text x="48" y="66" textAnchor="middle" fontSize="9" fill={NX.fgDim}>
        / {total}
      </text>
    </svg>
  );
}

// ─────────────────────────── Stats row ─────────────────────────────────

function StatsRow({ upcoming, past }: { upcoming: EventDto[]; past: EventDto[] }) {
  const totalRsvps = past.reduce((s, e) => s + e.rsvps.filter((r) => r.value === 'yes').length, 0);
  const totalPossible = past.reduce((s, e) => s + e.rsvps.length, 0);
  const rsvpRate = totalPossible > 0 ? Math.round((totalRsvps / totalPossible) * 100) : null;
  const avgPresence = past.length > 0 ? (totalRsvps / past.length).toFixed(1) : '—';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <StatCard icon="calendarCheck" label="À venir" value={upcoming.length.toString()} unit="events" />
      <StatCard icon="checks" label="Taux RSVP" value={rsvpRate !== null ? rsvpRate.toString() : '—'} unit={rsvpRate !== null ? '%' : ''} />
      <StatCard icon="users" label="Présence moy." value={avgPresence} unit="pers" />
    </div>
  );
}

function StatCard({
  icon, label, value, unit,
}: { icon: 'calendarCheck' | 'checks' | 'users'; label: string; value: string; unit: string }) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgMuted, fontWeight: 500, marginBottom: 6 }}>
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: NX.fg, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <span style={{ fontSize: 11, color: NX.fgDim, fontWeight: 500, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Section header ────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: 0, letterSpacing: '-0.01em' }}>
        {title}
      </h3>
      <span style={{ fontSize: 11, color: NX.fgDim }}>{count}</span>
    </div>
  );
}

// ─────────────────────────── Right rail ────────────────────────────────

function ActivityFeed({
  events,
  userId,
  groupId,
}: {
  events: EventDto[];
  userId: string | undefined;
  groupId: string | undefined;
}) {
  const membersQ = useGroupMembers(groupId);
  const members = membersQ.data ?? [];
  const nameById = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members],
  );

  // Activity = derniers RSVPs sur les events à venir, triés desc
  const activity = useMemo(() => {
    const items: { eventId: string; eventTitle: string; userId: string; value: 'yes' | 'maybe' | 'no'; date: string }[] = [];
    for (const e of events) {
      for (const r of e.rsvps) {
        items.push({
          eventId: e.id,
          eventTitle: e.title,
          userId: r.userId,
          value: r.value,
          date: e.updatedAt,
        });
      }
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items.slice(0, 5);
  }, [events]);

  const displayNameOf = (uid: string) =>
    uid === userId ? 'Toi' : nameById.get(uid) ?? uid.slice(0, 6);

  return (
    <RailBlock icon="clock" title="Activité récente">
      {activity.length === 0 ? (
        <div style={{ fontSize: 12, color: NX.fgDim }}>Aucune activité.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activity.map((a, i) => {
            const name = displayNameOf(a.userId);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={name} size={22} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: NX.fg, fontWeight: 500 }}>{name}</span>
                  <span style={{ color: NX.fgMuted }}>
                    {' '}
                    {a.value === 'yes' ? 'a confirmé' : a.value === 'maybe' ? 'hésite pour' : 'décline'}
                  </span>
                  <div style={{ color: NX.fgDim, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.eventTitle}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </RailBlock>
  );
}

function QuickCreate({ onCreate }: { onCreate: () => void }) {
  return (
    <RailBlock icon="plusCircle" title="Créer rapidement">
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          background: NX.featEventsBg,
          border: `0.5px dashed ${NX.featEvents}55`,
          borderRadius: NX.radiusMd,
          color: NX.featEvents,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <PhIcon name="plus" size={16} color={NX.featEvents} />
        Nouvel événement
      </button>
      <div style={{ fontSize: 11, color: NX.fgGhost, marginTop: 8, lineHeight: 1.4 }}>
        Dimanche brunch ? Apéro impromptu ? Crée et partage le lien en 30s.
      </div>
    </RailBlock>
  );
}

function RailBlock({ icon, title, children }: { icon: 'clock' | 'plusCircle'; title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: NX.fgMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {title}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── Helpers ────────────────────────────────────

function isoDay(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function humanRelative(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms < 0) return 'passé';
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days < 7) return `dans ${days} jours`;
  if (days < 30) return `dans ${Math.floor(days / 7)} sem.`;
  return `dans ${Math.floor(days / 30)} mois`;
}

function useCountdown(target: Date): { d: number; h: number; m: number; s: number } | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ms = target.getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / (24 * 3600 * 1000));
  const h = Math.floor((ms % (24 * 3600 * 1000)) / (3600 * 1000));
  const m = Math.floor((ms % (3600 * 1000)) / (60 * 1000));
  const s = Math.floor((ms % (60 * 1000)) / 1000);
  return { d, h, m, s };
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
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        color: NX.fg,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3, flex: 1, marginRight: 8 }}>
          {event.title}
        </div>
        {myRsvp ? (
          <span
            style={{
              fontSize: 10,
              padding: '2px 7px',
              background: myRsvp === 'yes' ? NX.successBg : myRsvp === 'maybe' ? NX.warningBg : NX.errorBg,
              color: myRsvp === 'yes' ? NX.success : myRsvp === 'maybe' ? NX.warning : NX.error,
              borderRadius: NX.radiusPill,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {myRsvp === 'yes' ? 'Oui' : myRsvp === 'maybe' ? 'Peut-être' : 'Non'}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim }}>
        {date.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        {event.location ? ` · ${event.location}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: NX.fgMuted, marginTop: 2 }}>
        <span><b style={{ color: NX.success }}>{counts.yes}</b> oui</span>
        {counts.maybe > 0 ? <span><b style={{ color: NX.warning }}>{counts.maybe}</b> peut-être</span> : null}
        {counts.no > 0 ? <span><b style={{ color: NX.fgGhost }}>{counts.no}</b> non</span> : null}
      </div>
    </button>
  );
}

// ─────────────────────────── Style overrides DayPicker ──────────────────

function CalendarStyles() {
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
      .rdp-has-event:not(.rdp-selected) .rdp-day_button { position: relative; color: ${NX.fg}; }
      .rdp-has-event:not(.rdp-selected) .rdp-day_button::after {
        content: ''; position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
        width: 4px; height: 4px; border-radius: 999px; background: ${NX.featEvents};
      }
      .rdp-button_previous, .rdp-button_next { color: ${NX.fgMuted}; }
      .rdp-button_previous:hover, .rdp-button_next:hover { color: ${NX.fg}; }
      @media (max-width: 1280px) {
        .events-rail { display: none !important; }
      }
    `}</style>
  );
}
