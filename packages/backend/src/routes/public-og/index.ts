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
 * Construit le template Satori d'une ressource — ce qui sera dessiné, et ce
 * qui fait la clé de cache (cf. `ogCacheKey`). Renvoie null si la ressource
 * n'existe pas.
 */
async function buildTemplateForSlug(type: OgType, slug: string): Promise<OgTemplate | null> {
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
      return eventTemplate({
        title: ev.title,
        startsAt: ev.startsAt.toISOString(),
        location: ev.location,
        rsvpCounts: counts,
      });
    }
    case 'poll': {
      const p = await getPollBySlug(slug);
      if (!p) return null;
      const totalVotes = p.options.reduce((sum, o) => sum + o.voters.length, 0);
      return pollTemplate({
        question: p.question,
        multi: p.multi,
        options: p.options.map((o) => ({ label: o.label, voteCount: o.voters.length })),
        totalVotes,
        closesAt: p.closesAt ? p.closesAt.toISOString() : null,
      });
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
      return expenseTemplate({
        description: e.description,
        amountCents: e.amountCents,
        currency: e.currency,
        paidByName: payer?.displayName ?? 'quelqu’un',
        participantCount: e.shares.length,
      });
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
      return type === 'todo' ? todoTemplate(tplInput) : listTemplate(tplInput);
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
        // Le détail (quel fichier, quel chemin) part dans les logs Pino
        // (`og-renderer.ts`), pas dans une réponse publique non authentifiée.
        return reply.code(503).header('Cache-Control', 'no-store').type('application/json').send({
          code: 'OG_FONTS_MISSING',
          message: 'OG image rendering temporarily unavailable.',
        });
      }

      const template = await buildTemplateForSlug(type, slug);
      if (!template) {
        throw new AppError('RESOURCE_NOT_FOUND', { type, slug });
      }

      const png = await renderOgPng({ type, slug, template });

      // Plus d'`immutable` 30 jours sur une URL stable (cf. 163de7bb) : les
      // clients et CDN qui avaient l'image la gardaient un mois quoi qu'on
      // fasse côté serveur, alors que l'image peut changer à tout moment. Les
      // plateformes sociales fetchent côté serveur et cachent de leur côté
      // sans tenir compte de ce header ; 5 minutes absorbent une rafale de
      // partages d'un même lien sans rien figer. Le vrai cache est Redis,
      // adressé par le contenu.
      return reply
        .code(200)
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=300')
        .send(png);
    },
  );
};
