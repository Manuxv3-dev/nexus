import type { FastifyPluginAsync } from 'fastify';

/**
 * Plugin Fastify killer features — STUB J4b.
 *
 * Toutes les routes stubs ont été migrées vers leurs plugins dédiés
 * (J5b sous-jalons #38 → #41) :
 *   - Events    → `eventsPlugin`   (cf. routes/events/index.ts)
 *   - Polls     → `pollsPlugin`    (cf. routes/polls/index.ts)
 *   - Expenses  → `expensesPlugin` (cf. routes/expenses/index.ts)
 *   - Todos     → `todosPlugin`    (cf. routes/todos/index.ts)
 *
 * Ce plugin est conservé temporairement comme no-op pour ne pas casser
 * `server.ts` qui le `register` toujours. Sera supprimé en J5b #45 (cleanup
 * final). Le `store.ts` in-memory n'est plus consommé non plus mais reste
 * sur le disque jusqu'à ce cleanup (cf. backlog "remplacer le store in-memory
 * killer features" — désormais résolu).
 */
export const killerFeaturesPlugin: FastifyPluginAsync = async (_app) => {
  // No-op : toutes les routes ont été remplacées par les plugins dédiés.
};
