import { mergeConfig, defineConfig } from 'vitest/config';

import rootConfig from '../../vitest.config';

/**
 * Config Vitest @nexus/backend — hérite de la config racine et relève
 * `hookTimeout` (défaut Vitest : 10s).
 *
 * Le `beforeAll` des tests d'intégration (`setupTestDb` + `buildServer`)
 * crée un schema Postgres dédié et rejoue toutes les migrations Drizzle en
 * série. Avec ~8 fichiers de suites gated-Postgres qui font ce travail en
 * parallèle (`fileParallelism` par défaut), le round-trip par statement vers
 * le conteneur Docker peut dépasser 10s sous contention — le hook time out
 * alors que le test lui-même est correct (`vitest run --no-file-parallelism`
 * fait passer les mêmes 143 tests sans changement de code). Constaté en
 * ajoutant la 4e suite gated-Postgres du module push (MAN-142, task 6/6).
 */
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      hookTimeout: 30_000,
    },
  }),
);
