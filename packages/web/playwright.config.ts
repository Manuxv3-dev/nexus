import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright e2e @nexus/web (cf. MAN-22).
 *
 * Scope volontairement minimal : login → onboarding → app shell → switch de
 * groupe → ouvrir un panel feature (`e2e/smoke.spec.ts`). Tourne sur CHAQUE
 * PR (pas en nightly) — décision prise en ticket : le scope réduit garde le
 * coût de run bas, et ce chemin est assez central pour mériter de bloquer
 * une PR plutôt que d'attendre une exécution nocturne.
 *
 * `webServer` démarre backend + frontend automatiquement (migrations
 * incluses côté backend). Nécessite Postgres + Redis déjà joignables :
 *   - CI : services containers du job (cf. .github/workflows/ci.yml)
 *   - Local : `just compose-up`, puis pointer DATABASE_URL vers une base
 *     jetable (`nexus_test`, pas la base de dev) pour ne pas polluer tes
 *     données locales avec les users/groupes créés par le test.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // exactOptionalPropertyTypes : pas de `workers: undefined` explicite,
  // on omet la clé en local pour laisser Playwright choisir son défaut.
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // `turbo run dev` (pas `pnpm --filter ... dev` en direct) : dépend de
      // `^build`, donc build @nexus/shared d'abord si besoin — sans ça, tsx
      // résout l'import `@nexus/shared` vers un `dist/` qui n'existe pas
      // encore sur un checkout tout frais (cf. exports de shared/package.json).
      // Timeout généreux (2min) : sur un runner CI à froid, build de
      // @nexus/shared + drizzle-kit migrate + boot fastify peut dépasser
      // largement ce qu'on observe en local avec un cache turbo déjà chaud
      // (cf. échec CI du 2026-08-02 à 60s, aucun souci en local).
      command:
        'pnpm --filter @nexus/backend db:migrate && pnpm exec turbo run dev --filter=@nexus/backend',
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      cwd: '../..',
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec turbo run dev --filter=@nexus/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
