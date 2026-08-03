import { createHash } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { defineRoute } from '../../core/define-route.js';
import { loadEnv } from '../../core/env.js';
import { getDb } from '../../db/client.js';
import { waitlist } from '../../db/schema/index.js';

/**
 * Plugin Fastify waitlist (cf. MAN-21).
 *
 * La landing page capture des emails de bêta, persistés dans la table
 * `waitlist` (dédoublonnage par email, insensible à la casse, contrainte
 * portée par la DB — cf. schema). Endpoints publics, sans authentification —
 * réponse identique qu'on connaisse l'email ou non, à l'inscription comme à
 * la désinscription (anti-énumération).
 *
 * La désinscription est un POST (email en body), pas un DELETE avec l'email
 * en query string : un email dans l'URL finit dans les logs de requête
 * (serializer par défaut de Fastify/Pino) et dans les access logs du reverse
 * proxy en amont (Traefik), hors du contrôle de ce code — précisément ce
 * qu'un endpoint de désinscription RGPD doit éviter. Le hash tronqué
 * (`emailLogHash`) protège les logs applicatifs qu'on écrit nous-mêmes ; ne
 * jamais mettre l'email dans l'URL protège aussi ceux qu'on n'écrit pas.
 *
 * Rate-limité en local à ce plugin (cf. `app.register(rateLimit, ...)`
 * ci-dessous) plutôt que globalement : `@fastify/rate-limit` n'est câblé
 * nulle part ailleurs dans le serveur, et ce sont les deux seuls endpoints
 * publics non authentifiés qui écrivent en base — la persistance (vs le
 * `Set` en mémoire du stub précédent) rend ces écritures durables, donc
 * dignes d'être protégées d'un abus. Bucket partagé POST+DELETE : un pic de
 * désinscriptions peut retarder des inscriptions légitimes, mais séparer les
 * deux demanderait de faire passer une config par route à travers
 * `defineRoute` (qui ne la transmet pas aujourd'hui) — hors périmètre pour 2
 * endpoints à faible volume.
 */
const EmailField = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

const Body = z.object({
  email: EmailField,
  source: z.string().max(64).optional(),
});
const Reply = z.object({ ok: z.boolean() });

const UnsubscribeBody = z.object({
  email: EmailField,
});

function emailLogHash(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 12);
}

export const waitlistPlugin: FastifyPluginAsync = async (app) => {
  // Désactivé en environnement de test (max quasi illimité) : les suites
  // d'intégration enchaînent largement plus de 20 requêtes/minute sur ces
  // deux endpoints depuis la même IP simulée.
  const isTest = loadEnv().NODE_ENV === 'test';
  await app.register(rateLimit, { max: isTest ? 100_000 : 20, timeWindow: '1 minute' });

  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/waitlist',
      body: Body,
      reply: Reply,
      handler: async (req) => {
        const email = req.body.email;
        // Pas de `target` explicite : l'API typée de drizzle-orm n'accepte
        // qu'une colonne (IndexColumn), pas une expression — or la
        // contrainte unique porte sur `lower(email)` (cf. schema). Sans
        // ambiguïté ici : c'est la seule contrainte unique de la table.
        await getDb()
          .insert(waitlist)
          .values({ email, source: req.body.source ?? null })
          .onConflictDoNothing();
        req.log.info(
          { emailHash: emailLogHash(email), source: req.body.source ?? 'landing' },
          'waitlist signup',
        );
        // Réponse identique qu'on connaisse l'email ou non — anti-énumération.
        return { ok: true };
      },
    }),
  );

  await app.register(
    defineRoute({
      method: 'POST',
      url: '/api/v1/waitlist/unsubscribe',
      body: UnsubscribeBody,
      reply: Reply,
      handler: async (req) => {
        const email = req.body.email;
        await getDb()
          .delete(waitlist)
          .where(sql`lower(${waitlist.email}) = ${email}`);
        req.log.info({ emailHash: emailLogHash(email) }, 'waitlist unsubscribe');
        // Réponse identique que l'email ait été trouvé ou non — anti-énumération.
        return { ok: true };
      },
    }),
  );
};
