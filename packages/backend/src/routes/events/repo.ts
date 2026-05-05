/**
 * Repository Events — accès Drizzle aux tables `events` + `event_rsvps`.
 *
 * Garde les routes Fastify minces (uniquement validation + auth + appel
 * repo + propagation WS).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { generateSlug } from '../../core/slug-generator.js';
import { getDb } from '../../db/client.js';
import {
  eventRsvps,
  events,
  type Event,
  type EventRsvp,
  type NewEvent,
} from '../../db/schema/index.js';

export type RsvpValue = 'yes' | 'maybe' | 'no';

export interface EventWithRsvps extends Event {
  rsvps: { userId: string; value: RsvpValue }[];
}

export interface CreateEventInput {
  groupId: string;
  tags?: string[];
  title: string;
  description?: string | null;
  startsAt: Date;
  location?: string | null;
  createdBy: string;
}

export interface UpdateEventInput {
  tags?: string[];
  title?: string;
  description?: string | null;
  startsAt?: Date;
  location?: string | null;
}

// ─────────────────────────── Mutations ───────────────────────────────────

export async function createEvent(input: CreateEventInput): Promise<Event> {
  const db = getDb();
  const slug = generateSlug();
  const insert: NewEvent = {
    slug,
    groupId: input.groupId,
    tags: input.tags ?? [],
    title: input.title,
    description: input.description ?? null,
    startsAt: input.startsAt,
    location: input.location ?? null,
    createdBy: input.createdBy,
  };
  const [row] = await db.insert(events).values(insert).returning();
  if (!row) throw new Error('insert event failed');
  return row;
}

export async function updateEvent(
  id: string,
  patch: UpdateEventInput,
): Promise<Event | undefined> {
  const db = getDb();
  // exactOptionalPropertyTypes : on construit l'objet en omettant les keys
  // absentes, sinon `undefined` serait écrit en DB.
  const set: Partial<NewEvent> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
  if (patch.location !== undefined) set.location = patch.location;
  const [row] = await db.update(events).set(set).where(eq(events.id, id)).returning();
  return row;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(events).where(eq(events.id, id)).returning({ id: events.id });
  return result.length > 0;
}

/**
 * Upsert d'un RSVP. `value === null` supprime l'entrée (équivalent
 * "annuler ma réponse" → état "non répondu").
 *
 * Retourne le RSVP courant (ou null si supprimé).
 */
export async function upsertRsvp(
  eventId: string,
  userId: string,
  value: RsvpValue | null,
): Promise<EventRsvp | null> {
  const db = getDb();
  // Touch events.updated_at pour invalider les caches dépendants (cache OG
  // image notamment, qui versionne sa clé sur updatedAt).
  await db.update(events).set({ updatedAt: new Date() }).where(eq(events.id, eventId));
  if (value === null) {
    await db
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
    return null;
  }
  const [row] = await db
    .insert(eventRsvps)
    .values({ eventId, userId, value })
    .onConflictDoUpdate({
      target: [eventRsvps.eventId, eventRsvps.userId],
      set: { value, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('upsert rsvp failed');
  return row;
}

// ─────────────────────────── Lectures ────────────────────────────────────

export async function getEventById(id: string): Promise<EventWithRsvps | null> {
  const db = getDb();
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) return null;
  const rsvps = await db
    .select({ userId: eventRsvps.userId, value: eventRsvps.value })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, row.id));
  return {
    ...row,
    rsvps: rsvps.map((r) => ({ userId: r.userId, value: r.value as RsvpValue })),
  };
}

export async function getEventBySlug(slug: string): Promise<EventWithRsvps | null> {
  const db = getDb();
  const [row] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!row) return null;
  return getEventById(row.id);
}

export interface ListEventsFilter {
  /** 'upcoming' = startsAt >= now, 'past' = startsAt < now, 'all' = pas de filtre */
  when?: 'upcoming' | 'past' | 'all';
}

export async function listEventsByGroup(
  groupId: string,
  filter: ListEventsFilter = {},
): Promise<EventWithRsvps[]> {
  const db = getDb();
  const when = filter.when ?? 'all';
  const conditions = [eq(events.groupId, groupId)];
  if (when === 'upcoming') {
    conditions.push(sql`${events.startsAt} >= now()`);
  } else if (when === 'past') {
    conditions.push(sql`${events.startsAt} < now()`);
  }
  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.startsAt));

  if (rows.length === 0) return [];

  // Charge les RSVPs en bulk pour éviter le N+1.
  const eventIds = rows.map((r) => r.id);
  const rsvps = await db.select().from(eventRsvps).where(inArray(eventRsvps.eventId, eventIds));

  const rsvpsByEvent = new Map<string, { userId: string; value: RsvpValue }[]>();
  for (const r of rsvps) {
    const list = rsvpsByEvent.get(r.eventId) ?? [];
    list.push({ userId: r.userId, value: r.value as RsvpValue });
    rsvpsByEvent.set(r.eventId, list);
  }

  return rows.map((row) => ({
    ...row,
    rsvps: rsvpsByEvent.get(row.id) ?? [],
  }));
}
