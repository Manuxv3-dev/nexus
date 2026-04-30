import { defineConfig } from 'vitest/config';

/**
 * Configuration Vitest racine.
 * Chaque package peut avoir son propre vitest.config.ts qui surcharge.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.ts', '**/*.{test,spec}.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.{ts,js}',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/*.{test,spec}.ts',
      ],
    },
  },
});
