import { mergeConfig, defineConfig } from 'vitest/config';

import viteConfig from './vite.config';

/**
 * Config Vitest @nexus/web — hérite des alias/plugins de vite.config.ts
 * (mergeConfig) et surcharge l'environnement du vitest.config.ts racine
 * (`node`) en `jsdom`, nécessaire pour tester des composants React.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // e2e/ est le domaine de Playwright (testDir dédié dans
      // playwright.config.ts) : sans cette exclusion, `smoke.spec.ts` matche
      // aussi le pattern `**/*.spec.ts` de vitest.config.ts racine et casse
      // au runtime (imports `@playwright/test` incompatibles avec vitest).
      exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', 'e2e/**'],
    },
  }),
);
