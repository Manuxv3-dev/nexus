/**
 * Dashboard Events — refonte structurelle (cf. ADR-021 + bundle HTML
 * 08-events-dashboard-desktop.html, J5c).
 *
 * Layout interne au panel main de l'AppShell :
 *  - Main (1fr) : Hero next event + countdown + RSVP donut, stats row,
 *    grid calendar+upcoming list, past list (filtre)
 *  - Right rail (340px ≥1280px, empilé sous le contenu en dessous — cf.
 *    DashboardLayout) : activity feed + quick create
 *
 * Le sidebar group context est fourni par AppShell (GroupsRail + ChannelsPane),
 * pas dupliqué ici.
 *
 * Note IA : composants Suggestions nexus du bundle HTML mis de côté
 * (cf. brief 2026-05-03 "tu ne tiendras pas compte des composants liés à
 * la feature IA"). On ajoute Quick Create à la place.
 */
import { useEffect, useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

import { Avatar, PhIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canManageGroupItem } from '@/lib/permissions';
import { useEvent, useEvents, useGroupMembers, useGroups, type EventDto } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { DashboardLayout, DashboardRail } from './DashboardLayout';
import { EventModal } from './events/EventModal';
import { FeatureShell, FilterChip, FilterDivider } from './FeatureShell';
import { Placeholder } from './Placeholder';

type Filter = 'upcoming' | 'mine' | 'past';

export function EventsDashboard({
  groupId,
  openItemId,
  openCreate,
  openDate,
  onConsumeOpen,
}: {
  /** Groupe actif sélectionné dans la sidebar. Si absent, fallback sur le 1er groupe. */
  groupId?: string;
  openItemId?: string | null;
  /**
   * MAN-246 : intention de création émise par un CTA « Créer X » (HeroCard
   * vide de `GroupHomeDashboard`, QuickAction de `HomeDashboard`). Même canal
   * que `openItemId` — le shell la pose dans `pendingOpen`, le dashboard
   * l'ouvre au montage et la consomme via `onConsumeOpen`.
   */
  openCreate?: boolean | undefined;
  /**
   * Jour à présélectionner (`YYYY-MM-DD`, local) — clic sur une case du
   * calendrier semaine. Troisième intention portée par le même canal que
   * `openItemId` et `openCreate` ; elle sélectionne le jour au lieu d'ouvrir
   * un item, parce que c'est le jour entier que l'utilisateur a désigné.
   */
  openDate?: string | null | undefined;
  onConsumeOpen?: () => void;
} = {}) {
  const { user } = useAuth();
  const groupsQ = useGroups();
  const groups = groupsQ.data ?? [];
  // Fix 2026-05-05 : on respecte le groupe actif passé par AppShell. Le
  // fallback `groups[0]?.id` est conservé pour la compat (cas où le dashboard
  // serait monté sans contexte AppShell, ex: tests).
  const activeGroupId = groupId ?? groups[0]?.id;
  // MAN-246 : le rôle du viewer dans ce groupe décide, avec l'auteur de
  // l'item, s'il peut le modifier ou le supprimer.
  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const [filter, setFilter] = useState<Filter>('upcoming');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'view' | 'edit'; eventId: string } | null
  >(null);

  // Deep-link depuis une notification : ouvrir l'event correspondant.
  useEffect(() => {
    if (openItemId) {
      setModal({ mode: 'view', eventId: openItemId });
      onConsumeOpen?.();
    } else if (openCreate) {
      setModal({ mode: 'create' });
      onConsumeOpen?.();
    } else if (openDate) {
      // Pas de modale : on positionne la sélection de jour. `eventsForSelectedDay`
      // ignore délibérément le chip de filtre (cf. plus bas), donc le jour
      // montre tout ce qu'il porte — y compris du passé.
      setSelectedDate(parseIsoDayLocal(openDate));
      onConsumeOpen?.();
    }
  }, [openItemId, openCreate, openDate, onConsumeOpen]);

  // Une seule requête `all`, découpée côté client. Deux requêtes
  // `upcoming`/`past` séparées coûtaient un aller-retour de plus et, surtout,
  // pouvaient répondre à deux instants différents : un événement franchissant
  // `now()` entre les deux apparaissait alors dans les deux listes ou dans
  // aucune. Ici la coupure est faite une fois, sur un jeu de données unique.
  const eventsQ = useEvents(activeGroupId, { when: 'all' });
  const allEvents = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: EventDto[] = [];
    const old: EventDto[] = [];
    for (const e of allEvents) {
      (new Date(e.startsAt).getTime() >= now ? up : old).push(e);
    }
    // Le backend trie par `startsAt` croissant ; les passés se lisent mieux du
    // plus récent au plus ancien.
    old.reverse();
    return { upcoming: up, past: old };
  }, [allEvents]);

  // Ce que le chip sélectionne : la LISTE, jamais le calendrier (cf. plus bas).
  const listSource = filter === 'past' ? past : upcoming;
  const filteredEvents = useMemo(() => {
    if (filter !== 'mine' || !user) return listSource;
    return listSource.filter((e) => !e.rsvps.some((r) => r.userId === user.id));
  }, [listSource, filter, user]);

  const nextEvent = upcoming[0];

  // Calendrier : dérivé de `allEvents`, pas de `filteredEvents`. Un calendrier
  // mensuel montre par nature le passé et le futur sur la même grille — le
  // faire suivre le chip revenait à cacher la moitié du mois et à répondre
  // « Rien le … » sur un jour qui portait bien un événement.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventDto[]>();
    for (const e of allEvents) {
      const key = isoDay(new Date(e.startsAt));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [allEvents]);

  const dayModifiers = useMemo(
    () => ({ hasEvent: allEvents.map((e) => new Date(e.startsAt)) }),
    [allEvents],
  );

  // Jour sélectionné → tout ce qu'il porte, indépendamment du chip : on a
  // demandé CE jour, pas « ce jour parmi les à venir ».
  const eventsForSelectedDay = selectedDate
    ? (eventsByDay.get(isoDay(selectedDate)) ?? [])
    : filteredEvents;

  const modalEventId = modal?.mode === 'view' || modal?.mode === 'edit' ? modal.eventId : undefined;
  const fromList =
    modalEventId !== undefined ? allEvents.find((e) => e.id === modalEventId) : undefined;
  // Fallback : si l'event n'est pas dans la liste courante (filtre actif,
  // event hors fenêtre upcoming/past, deep-link depuis notif), on le fetch
  // par ID. Hook conditionnel via `enabled`.
  const fallbackEventQ = useEvent(fromList ? undefined : modalEventId);
  const openEvent = fromList ?? fallbackEventQ.data;

  return (
    <FeatureShell
      iconName="calendarBlank"
      iconColor={NX.featEvents}
      iconBg={NX.featEventsBg}
      title="Événements"
      subtitle={`${upcoming.length} à venir · ${past.length} passés`}
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
      ) : eventsQ.isError ? (
        // MAN-244 : sans cette branche, un échec laissait `data` à `undefined`,
        // donc la liste vide, donc « Pas encore d'événements » — l'UI affirmait
        // le vide depuis son ignorance.
        <div style={{ color: NX.error, padding: 24 }}>Impossible de charger les événements.</div>
      ) : eventsQ.isPending ? (
        // `isPending`, pas `isLoading` : cette query est désactivée le temps que
        // l'auth se résolve, et en TanStack v5 une query désactivée rapporte
        // `isLoading === false` avec `isPending === true` (piège de MAN-231).
        <div style={{ color: NX.fgMuted, padding: 24 }}>Chargement…</div>
      ) : (
        <DashboardLayout>
          {/* MAIN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {nextEvent && filter === 'upcoming' ? (
              <NextEventHero
                event={nextEvent}
                onOpen={() => setModal({ mode: 'view', eventId: nextEvent.id })}
              />
            ) : null}

            {/* Post-2026-05-05 : StatsRow retiré. Les KPIs "Taux RSVP" et
                "Présence moy." étaient peu actionnables sur de petits volumes,
                et "À venir" duplique le sous-titre de la page. */}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
                gap: 20,
                alignItems: 'stretch',
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
                  title={
                    selectedDate
                      ? `Événements du ${selectedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
                      : filter === 'past'
                        ? 'Événements passés'
                        : 'Événements à venir'
                  }
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
          <DashboardRail>
            <QuickCreate onCreate={() => activeGroupId && setModal({ mode: 'create' })} />
            <ActivityFeed events={upcoming} userId={user?.id} groupId={activeGroupId} />
          </DashboardRail>
        </DashboardLayout>
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
            canEdit={canManageGroupItem({
              userId: user?.id,
              authorId: openEvent.createdBy,
              role: activeGroup?.role,
            })}
            onClose={() => setModal(null)}
            onSwitchToEdit={() => setModal({ mode: 'edit', eventId: openEvent.id })}
          />
        ) : null
      ) : null}
    </FeatureShell>
  );
}

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
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 14,
            fontSize: 13,
            color: NX.fgMuted,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <PhIcon name="calendarBlank" size={14} color={NX.fgMuted} />
            {date.toLocaleString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
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
        <RsvpDonut
          yes={counts.yes}
          maybe={counts.maybe}
          total={Math.max(totalAnswered, event.rsvps.length, 1)}
        />
        <div style={{ fontSize: 11, color: NX.fgDim, textAlign: 'center' }}>
          <div>
            <span style={{ color: NX.success, fontWeight: 600 }}>{counts.yes}</span> oui ·{' '}
            <span style={{ color: NX.warning, fontWeight: 600 }}>{counts.maybe}</span> peut-être
          </div>
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
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: NX.fg,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toString().padStart(2, '0')}
      </div>
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          color: NX.fgDim,
          letterSpacing: '0.08em',
          marginTop: 4,
        }}
      >
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
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={NX.success}
        strokeWidth="10"
        strokeDasharray={`${yesArc} ${c}`}
        transform="rotate(-90 48 48)"
        strokeLinecap="round"
      />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={NX.warning}
        strokeWidth="10"
        strokeDasharray={`${maybeArc} ${c}`}
        strokeDashoffset={-yesArc}
        transform="rotate(-90 48 48)"
        strokeLinecap="round"
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

// ─────────────────────────── Section header ────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <h3
        style={{ fontSize: 13, fontWeight: 600, color: NX.fg, margin: 0, letterSpacing: '-0.01em' }}
      >
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
  const nameById = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);

  // Activity = derniers RSVPs sur les events à venir, triés desc
  const activity = useMemo(() => {
    const items: {
      eventId: string;
      eventTitle: string;
      userId: string;
      value: 'yes' | 'maybe' | 'no';
      date: string;
    }[] = [];
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
    uid === userId ? 'Toi' : (nameById.get(uid) ?? uid.slice(0, 6));

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
                    {a.value === 'yes'
                      ? 'a confirmé'
                      : a.value === 'maybe'
                        ? 'hésite pour'
                        : 'décline'}
                  </span>
                  <div
                    style={{
                      color: NX.fgDim,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
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

function RailBlock({
  icon,
  title,
  children,
}: {
  icon: 'clock' | 'plusCircle';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NX.fgMuted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        <PhIcon name={icon} size={14} color={NX.fgMuted} />
        {title}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── Helpers ────────────────────────────────────

/**
 * Inverse d'`isoDay` : `YYYY-MM-DD` → Date locale à minuit.
 *
 * Pas `new Date('2026-09-15')` : la forme courte est parsée comme UTC, donc à
 * l'ouest de Greenwich elle retombe sur la veille — le dashboard sélectionnerait
 * un autre jour que celui cliqué.
 */
function parseIsoDayLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

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
  const myRsvp = user ? (event.rsvps.find((r) => r.userId === user.id)?.value ?? null) : null;
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
              background:
                myRsvp === 'yes' ? NX.successBg : myRsvp === 'maybe' ? NX.warningBg : NX.errorBg,
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
        {date.toLocaleString('fr-FR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {event.location ? ` · ${event.location}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: NX.fgMuted, marginTop: 2 }}>
        <span>
          <b style={{ color: NX.success }}>{counts.yes}</b> oui
        </span>
        {counts.maybe > 0 ? (
          <span>
            <b style={{ color: NX.warning }}>{counts.maybe}</b> peut-être
          </span>
        ) : null}
        {counts.no > 0 ? (
          <span>
            <b style={{ color: NX.fgGhost }}>{counts.no}</b> non
          </span>
        ) : null}
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
    `}</style>
  );
}
