import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';

import { registerErrorHandler } from './core/error-handler.js';
import { loadEnv } from './core/env.js';
import { loggerOptions } from './core/logger.js';
import { authPlugin } from './routes/auth/index.js';
import { groupsPlugin } from './routes/groups/index.js';
import { healthRoute } from './routes/health/health.js';
import { wsPlugin } from './ws/index.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => `req_${nanoid(16)}`,
    disableRequestLogging: false,
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: env.NODE_ENV === 'development' ? true : false,
    credentials: true,
  });

  registerErrorHandler(app);

  await app.register(healthRoute);
  await app.register(authPlugin);
  await app.register(groupsPlugin);
  await app.register(wsPlugin);

  return app;
}
