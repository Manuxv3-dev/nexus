import type { FastifyReply, FastifyRequest } from 'fastify';

import { verifyAccessToken } from '../../routes/auth/service.js';
import { AppError } from '../errors.js';

/**
 * Identité authentifiée attachée à `req.user` après passage par `requireAuth`.
 */
export interface AuthUser {
  id: string;
  groupIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Pré-handler qui vérifie un Bearer token JWT dans l'header Authorization,
 * attache req.user, ou throw AUTH_NOT_AUTHENTICATED.
 *
 * Utilisable via defineRoute({ preHandlers: [requireAuth], ... }).
 *
 * Note : on ne type pas avec `preHandlerHookHandler` parce que ce type
 * n'aime pas les fonctions async qui ne renvoient pas explicitement
 * `Promise<void>`. La signature ci-dessous matche ce que Fastify attend
 * en pratique.
 */
// Signature async imposée par le tableau `preHandlers` (cf. note plus haut) ;
// verifyAccessToken est synchrone, donc pas d'await interne ici.
// eslint-disable-next-line @typescript-eslint/require-await
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    throw new AppError('AUTH_NOT_AUTHENTICATED');
  }

  const token = auth.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError('AUTH_NOT_AUTHENTICATED');
  }

  const payload = verifyAccessToken(token);
  req.user = { id: payload.sub, groupIds: payload.groupIds };
}

/**
 * Helper : récupère l'utilisateur authentifié attaché à la requête, ou throw
 * `INTERNAL_ERROR` si absent — signifie qu'on a oublié `requireAuth` dans les
 * preHandlers de la route. Même pattern que `getGroupContext`
 * (require-group-membership.ts).
 */
export function getAuthUser(req: FastifyRequest): AuthUser {
  if (!req.user) {
    throw new AppError('INTERNAL_ERROR', { reason: 'missing_auth_user' });
  }
  return req.user;
}
