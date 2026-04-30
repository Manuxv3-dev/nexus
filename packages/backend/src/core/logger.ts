import pino, { type Logger, type LoggerOptions } from 'pino';

import { loadEnv } from './env.js';

/**
 * Logger pino configuré pour Nexus.
 *
 * - En développement : pino-pretty pour des logs lisibles
 * - En test : niveau silent par défaut (override via LOG_LEVEL=debug si besoin)
 * - En production : JSON structuré, niveau info, redaction des secrets
 *
 * On exporte deux choses :
 * - `loggerOptions` : passées à Fastify via `logger:` pour qu'il crée son propre
 *   logger child (ce qui maintient le typage générique correctement)
 * - `logger` : instance utilisable hors-Fastify (workers, scripts, boot, etc.)
 */
function buildOptions(): LoggerOptions {
  const env = loadEnv();

  const base: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'passwordHash',
        'accessToken',
        'refreshToken',
        '*.password',
        '*.passwordHash',
        '*.accessToken',
        '*.refreshToken',
      ],
      censor: '[REDACTED]',
    },
    base: {
      pid: process.pid,
      env: env.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (env.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,env',
        },
      },
    };
  }

  return base;
}

export const loggerOptions: LoggerOptions = buildOptions();

export const logger: Logger = pino(loggerOptions);

export type { Logger };
