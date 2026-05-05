import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';

import { registerErrorHandler } from './core/error-handler.js';
import { loadEnv } from './core/env.js';
import { loggerOptions } from './core/logger.js';
import { activityPlugin } from './routes/activity/index.js';
import { authPlugin } from './routes/auth/index.js';
import { eventsPlugin } from './routes/events/index.js';
import { expensesPlugin } from './routes/expenses/index.js';
import { groupsPlugin } from './routes/groups/index.js';
import { healthRoute } from './routes/health/health.js';
import { homePlugin } from './routes/home/index.js';
import { killerFeaturesPlugin } from './routes/killer-features/index.js';
import { messagingPlugin } from './routes/messaging/index.js';
import { notificationsPlugin } from './routes/notifications/index.js';
import { pollsPlugin } from './routes/polls/index.js';
import { publicOgRoute } from './routes/public-og/index.js';
import { todosPlugin } from './routes/todos/index.js';
import { waitlistPlugin } from './routes/waitlist/index.js';
import { wsPlugin } from './ws/index.js';
import { startNexusRelay } from './ws/nexus-relay.js';

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
  await app.register(cookie, {});
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.NODE_ENV === 'development' ? true : false,
    credentials: true,
  });

  registerErrorHandler(app);

  await app.register(healthRoute);
  await app.register(authPlugin);
  await app.register(groupsPlugin);
  await app.register(messagingPlugin);
  await app.register(eventsPlugin);
  await app.register(pollsPlugin);
  await app.register(expensesPlugin);
  await app.register(todosPlugin);
  await app.register(notificationsPlugin);
  await app.register(activityPlugin);
  await app.register(homePlugin);
  await app.register(killerFeaturesPlugin);
  await app.register(publicOgRoute);
  await app.register(waitlistPlugin);
  await app.register(wsPlugin);

  // Demarre le relay Redis pubsub -> WS pour les events Nexus internes
  // (events / polls / expenses / todos — cf. ADR-003).
  // Depuis ADR-027 (universalisation webview messaging), il n'y a plus de
  // bridge worker côté serveur — toutes les messageries passent par la
  // webview encapsulée Tauri. Le `bridge-relay` historique a donc disparu.
  // Skip en environnement de test ou Redis peut etre absent ;
  // les tests d'integration gerent le demarrage explicitement.
  if (env.NODE_ENV !== 'test') {
    await startNexusRelay();
  }

  return app;
}
