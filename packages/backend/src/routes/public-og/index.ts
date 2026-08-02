/**
 * Endpoint Open Graph image dynamique.
 *
 *   GET /api/v1/public/og/:type/:slug.png
 *
 * `:type` ∈ { event | poll | expense | todo | list }
 *
 * Cf. ADR-018. Pipeline : fetch ressource → template Satori → SVG → PNG → cache Redis.
 *
 * On utilise `app.get` direct (sans `defineRoute`) parce que la sortie est
 * binaire (`image/png`), pas un JSON Zod-validé.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../core/errors.js';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { getEventBySlug } from '../events/repo.js';
import { getExpenseBySlug } from '../expenses/repo.js';
import { getPollBySlug } from '../polls/repo.js';
import { getTodoListBySlug } from '../todos/repo.js';

import { fontsAvailable, renderOgPng } from './og-renderer.js';
import {
  eventTemplate,
  expenseTemplate,
  listTemplate,
  pollTemplate,
  todoTemplate,
  type OgTemplate,
} from './templates.js';

const ParamsSchema = z.object({
  type: z.enum(['event', 'poll', 'expense', 'todo', 'list']),
  slugWithExt: z.string().regex(/^[A-Za-z0-9]{4,64}\.png$/, 'invalid_slug_or_extension'),
});

type OgType = z.infer<typeof ParamsSchema>['type'];

/**
 * Construit le template Satori et la version (`updatedAt`) d'une ressource.
 * Renvoie null si la ressource n'existe pas.
 */
async function buildTemplateForSlug(
  type: OgType,
  slug: string,
): Promise<{ template: OgTemplate; updatedAt: string } | null> {
  switch (type) {
    case 'event': {
      const ev = await getEventBySlug(slug);
      if (!ev) return null;
      const counts = { yes: 0, maybe: 0, no: 0 };
      for (const r of ev.rsvps) {
        if (r.value === 'yes') counts.yes += 1;
        else if (r.value === 'maybe') counts.maybe += 1;
        else if (r.value === 'no') counts.no += 1;
      }
      return {
        template: eventTemplate({
          title: ev.title,
          startsAt: ev.startsAt.toISOString(),
          location: ev.location,
          rsvpCounts: counts,
        }),
        // updatedAt sert de cache buster ; on prend l'updatedAt DB (mis à
        // jour à chaque mutation event ou rsvp via les routes).
        updatedAt: ev.updatedAt.toISOString(),
      };
    }
    case 'poll': {
      const p = await getPollBySlug(slug);
      if (!p) return null;
      const totalVotes = p.options.reduce((sum, o) => sum + o.voters.length, 0);
      return {
        template: pollTemplate({
          question: p.question,
          multi: p.multi,
          options: p.options.map((o) => ({ label: o.label, voteCount: o.voters.length })),
          totalVotes,
          closesAt: p.closesAt ? p.closesAt.toISOString() : null,
        }),
        updatedAt: p.updatedAt.toISOString(),
      };
    }
    case 'expense': {
      const e = await getExpenseBySlug(slug);
      if (!e) return null;
      // Sélection étroite (juste `displayName`) : route publique non
      // authentifiée, pas besoin de charger le reste de la ligne `users`.
      const db = getDb();
      const [payer] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, e.paidBy))
        .limit(1);
      return {
        template: expenseTemplate({
          description: e.description,
          amountCents: e.amountCents,
          currency: e.currency,
          paidByName: payer?.displayName ?? 'quelqu’un',
          participantCount: e.shares.length,
        }),
        updatedAt: e.updatedAt.toISOString(),
      };
    }
    case 'todo':
    case 'list': {
      const t = await getTodoListBySlug(slug);
      if (!t) return null;
      const itemsDone = t.items.filter((it) => it.done).length;
      const tplInput = {
        title: t.title,
        itemsTotal: t.items.length,
        itemsDone,
      };
      return {
        template: type === 'todo' ? todoTemplate(tplInput) : listTemplate(tplInput),
        updatedAt: t.updatedAt.toISOString(),
      };
    }
  }
}

// Le contrat `FastifyPluginAsync` impose une fonction async ; ce plugin
// enregistre une seule route synchrone (`app.get`, pas `await app.register`),
// donc pas d'await interne.
// eslint-disable-next-line @typescript-eslint/require-await
export const publicOgRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/public/og/:type/:slugWithExt',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = ParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', { issues: parsed.error.issues });
      }
      const { type, slugWithExt } = parsed.data;
      const slug = slugWithExt.slice(0, -'.png'.length);

      // Garde-fou : si les fonts ne sont pas installées, on log et on
      // renvoie 503 plutôt que de crasher.
      if (!(await fontsAvailable())) {
        return reply.code(503).header('Cache-Control', 'no-store').type('application/json').send({
          code: 'OG_FONTS_MISSING',
          message:
            'Inter fonts manquantes côté backend. Lance `pnpm --filter @nexus/backend setup:fonts`.',
        });
      }

      const built = await buildTemplateForSlug(type, slug);
      if (!built) {
        throw new AppError('RESOURCE_NOT_FOUND', { type, slug });
      }

      const png = await renderOgPng({
        type,
        slug,
        updatedAt: built.updatedAt,
        template: built.template,
      });

      return reply
        .code(200)
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=2592000, immutable')
        .send(png);
    },
  );
};
