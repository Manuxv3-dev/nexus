/**
 * @nexus/backend — entrypoint.
 *
 * Boot du serveur Fastify. Pour les tests on utilise `buildServer()` directement.
 */
import './bootstrap-env.js';

import { loadEnv } from './core/env.js';
import { logger } from './core/logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();

  try {
    await app.listen({ port: env.BACKEND_PORT, host: env.BACKEND_HOST });
    logger.info({ port: env.BACKEND_PORT, host: env.BACKEND_HOST }, 'Nexus backend listening');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Nexus backend');
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'Received shutdown signal');
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        },
      );
    });
  }
}

void main();
