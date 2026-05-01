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
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../core/errors.js';
import {
  getEventBySlug,
  getExpenseBySlug,
  getPollBySlug,
  getTodoBySlug,
} from '../killer-features/store.js';

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
 *
 * Note J5a : pas de champ `updatedAt` dans le store in-memory, on utilise
 * `createdAt` à la place. À switch quand les tables Drizzle débarquent (5b+).
 */
function buildTemplateForSlug(
  type: OgType,
  slug: string,
): { template: OgTemplate; updatedAt: string } | null {
  switch (type) {
    case 'event': {
      const ev = getEventBySlug(slug);
      if (!ev) return null;
      const counts = { yes: 0, maybe: 0, no: 0 };
      for (const v of Object.values(ev.rsvps)) {
        if (v === 'yes') counts.yes += 1;
        else if (v === 'maybe') counts.maybe += 1;
        else if (v === 'no') counts.no += 1;
      }
      return {
        template: eventTemplate({
          title: ev.title,
          startsAt: ev.startsAt,
          location: ev.location,
          rsvpCounts: counts,
        }),
        updatedAt: ev.createdAt,
      };
    }
    case 'poll': {
      const p = getPollBySlug(slug);
      if (!p) return null;
      const totalVotes = p.options.reduce((sum, o) => sum + o.voters.length, 0);
      return {
        template: pollTemplate({
          question: p.question,
          multi: p.multi,
          options: p.options.map((o) => ({ label: o.label, voteCount: o.voters.length })),
          totalVotes,
          closesAt: p.closesAt,
        }),
        updatedAt: p.createdAt,
      };
    }
    case 'expense': {
      const e = getExpenseBySlug(slug);
      if (!e) return null;
      return {
        template: expenseTemplate({
          description: e.description,
          amountCents: e.amountCents,
          currency: e.currency,
          paidByName: e.paidBy,
          participantCount: e.participants.length,
        }),
        updatedAt: e.createdAt,
      };
    }
    case 'todo':
    case 'list': {
      const t = getTodoBySlug(slug);
      if (!t) return null;
      const itemsDone = t.items.filter((it) => it.done).length;
      const tplInput = {
        title: t.title,
        itemsTotal: t.items.length,
        itemsDone,
      };
      return {
        template: type === 'todo' ? todoTemplate(tplInput) : listTemplate(tplInput),
        updatedAt: t.createdAt,
      };
    }
  }
}

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
        return reply
          .code(503)
          .header('Cache-Control', 'no-store')
          .type('application/json')
          .send({
            code: 'OG_FONTS_MISSING',
            message:
              'Inter fonts manquantes côté backend. Lance `pnpm --filter @nexus/backend setup:fonts`.',
          });
      }

      const built = buildTemplateForSlug(type, slug);
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
