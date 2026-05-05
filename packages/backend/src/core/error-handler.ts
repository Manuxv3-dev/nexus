import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError, ERROR_CODES, type ErrorCode } from './errors.js';

/**
 * Réponse d'erreur normalisée renvoyée au client.
 *
 * Format stable, partagée avec @nexus/shared (à dupliquer côté shared en J1c
 * ou plus tard pour la consommation typée côté client).
 */
interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details: unknown;
    requestId: string;
  };
}

function buildResponse(
  code: ErrorCode,
  message: string,
  details: unknown,
  requestId: string,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      details: details ?? null,
      requestId,
    },
  };
}

/**
 * Plugin Fastify qui installe :
 * - un `setErrorHandler` qui mappe AppError, ZodError, FastifyError → réponse JSON
 * - un `setNotFoundHandler` qui renvoie un 404 typé
 *
 * Tous les codes 5xx sont logués au niveau `error`. Les 4xx au niveau `warn`.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    // 1. AppError — erreur métier typée
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, details: err.details }, 'AppError');
      reply.code(err.httpStatus).send(buildResponse(err.code, err.message, err.details, requestId));
      return;
    }

    // 2. ZodError — validation a échoué (entrée API ou sortie defensive)
    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'ZodError');
      reply
        .code(ERROR_CODES.VALIDATION_ERROR.http)
        .send(
          buildResponse(
            'VALIDATION_ERROR',
            ERROR_CODES.VALIDATION_ERROR.message,
            { issues: err.issues },
            requestId,
          ),
        );
      return;
    }

    // 3. FastifyError typique — validation schéma Fastify, rate limit, etc.
    const fastifyErr = err as FastifyError;
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      req.log.warn({ err: fastifyErr }, 'FastifyError 4xx');
      const code: ErrorCode =
        fastifyErr.statusCode === 429
          ? 'RATE_LIMITED'
          : fastifyErr.statusCode === 404
            ? 'RESOURCE_NOT_FOUND'
            : 'VALIDATION_ERROR';
      reply
        .code(fastifyErr.statusCode)
        .send(buildResponse(code, fastifyErr.message, fastifyErr.validation ?? null, requestId));
      return;
    }

    // 4. Erreur inattendue — 500
    req.log.error({ err }, 'Unhandled error');
    reply
      .code(ERROR_CODES.INTERNAL_ERROR.http)
      .send(buildResponse('INTERNAL_ERROR', ERROR_CODES.INTERNAL_ERROR.message, null, requestId));
  });

  app.setNotFoundHandler((req, reply) => {
    reply
      .code(ERROR_CODES.RESOURCE_NOT_FOUND.http)
      .send(
        buildResponse(
          'RESOURCE_NOT_FOUND',
          `Route ${req.method} ${req.url} not found`,
          null,
          req.id,
        ),
      );
  });
}
