import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { defineRoute } from '../../core/define-route.js';

/**
 * Plugin Fastify waitlist — STUB J4-pre.
 *
 * La landing page (cf. roadmap.md J4-pre) capture des emails de beta. Pour
 * l'instant on stocke en mémoire et on log. La vraie persistance (table
 * `waitlist` Drizzle + dédoublonnage + lien désinscription) arrive en J4-pre.
 *
 * Cf. .agent/backlog.md → "Persister la waitlist".
 */
const seen = new Set<string>();

const Body = z.object({
  email: z.string().email().max(254),
  source: z.string().max(64).optional(),
});
const Reply = z.object({ ok: z.boolean() });

export const waitlistPlugin: FastifyPluginAsync = async (app) => {
  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/waitlist',
      body: Body,
      reply: Reply,
      handler: async (req) => {
        const email = req.body.email.toLowerCase().trim();
        const wasNew = !seen.has(email);
        seen.add(email);
        req.log.info({ email, source: req.body.source ?? 'landing', wasNew }, 'waitlist signup');
        // Réponse identique qu'on connaisse l'email ou non — anti-énumération.
        return { ok: true };
      },
    }),
  );
};
