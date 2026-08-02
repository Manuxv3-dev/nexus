import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { z, ZodTypeAny } from 'zod';

/**
 * Helper de définition d'endpoint REST typé end-to-end.
 *
 * Usage :
 *
 *   const Body = z.object({ email: z.string().email(), password: z.string().min(12) });
 *   const Reply = z.object({ accessToken: z.string(), refreshToken: z.string() });
 *
 *   export const loginRoute = defineRoute({
 *     method: 'POST',
 *     url: '/api/v1/auth/login',
 *     body: Body,
 *     reply: Reply,
 *     handler: async (req) => {
 *       // req.body est typé z.infer<typeof Body>
 *       const result = await authService.login(req.body);
 *       return result; // doit matcher z.infer<typeof Reply>
 *     },
 *   });
 *
 *   // Dans un plugin Fastify :
 *   await app.register(loginRoute);
 *
 * Bénéfices :
 *   - Validation Zod automatique en entrée (body/query/params)
 *   - Validation Zod automatique en sortie (defensive : empêche les fuites)
 *   - Le `handler` est typé au compile-time, le moindre drift = build error
 *   - preHandlers Fastify standard pour l'auth, la membership, etc.
 *
 * Cf. skill `.agent/skills/create-api-endpoint.md` pour les patterns.
 */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type InferOrUndefined<T> = T extends ZodTypeAny ? z.infer<T> : undefined;
type InferOrUnknown<T> = T extends ZodTypeAny ? z.infer<T> : unknown;

interface DefineRouteOpts<
  Body extends ZodTypeAny | undefined,
  Query extends ZodTypeAny | undefined,
  Params extends ZodTypeAny | undefined,
  Reply extends ZodTypeAny,
> {
  method: HttpMethod;
  url: string;
  body?: Body;
  query?: Query;
  params?: Params;
  reply: Reply;
  preHandlers?: preHandlerHookHandler[];
  handler: (req: TypedRequest<Body, Query, Params>, reply: FastifyReply) => Promise<z.infer<Reply>>;
}

/**
 * FastifyRequest enrichi avec les types Zod inférés des schémas.
 * Helper utilisable côté handlers pour récupérer le bon typage.
 */
export type TypedRequest<
  Body extends ZodTypeAny | undefined = undefined,
  Query extends ZodTypeAny | undefined = undefined,
  Params extends ZodTypeAny | undefined = undefined,
> = FastifyRequest & {
  body: InferOrUndefined<Body>;
  query: InferOrUnknown<Query>;
  params: InferOrUnknown<Params>;
};

/**
 * Construit un plugin Fastify async qui enregistre la route définie.
 *
 * Utilisable directement dans `app.register()`.
 */
export function defineRoute<
  Body extends ZodTypeAny | undefined = undefined,
  Query extends ZodTypeAny | undefined = undefined,
  Params extends ZodTypeAny | undefined = undefined,
  Reply extends ZodTypeAny = ZodTypeAny,
>(opts: DefineRouteOpts<Body, Query, Params, Reply>) {
  // Contrat `FastifyPluginAsync` (utilisé via `app.register`) : la fonction
  // doit être async même si `fastify.route(...)` est un enregistrement
  // synchrone, sans await interne.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (fastify: FastifyInstance): Promise<void> => {
    fastify.route({
      method: opts.method,
      url: opts.url,
      ...(opts.preHandlers ? { preHandler: opts.preHandlers } : {}),
      handler: async (req, reply) => {
        if (opts.body) {
          // ZodTypeAny efface le type de sortie précis (Body est générique
          // ici) : .parse() renvoie `any` par construction. On l'annote en
          // `unknown` pour ne pas le propager sans le déclarer explicitement.
          const parsed: unknown = opts.body.parse(req.body);
          (req as { body: unknown }).body = parsed;
        }
        if (opts.query) {
          const parsed: unknown = opts.query.parse(req.query);
          (req as { query: unknown }).query = parsed;
        }
        if (opts.params) {
          const parsed: unknown = opts.params.parse(req.params);
          (req as { params: unknown }).params = parsed;
        }

        const result = await opts.handler(
          req as unknown as TypedRequest<Body, Query, Params>,
          reply,
        );

        const parsedReply: unknown = opts.reply.parse(result);
        return parsedReply;
      },
    });
  };
}
