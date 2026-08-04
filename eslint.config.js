// @ts-check
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      // Assets statiques servis tels quels (pas de build/bundler, pas de
      // tsconfig les couvrant) — ex: packages/web/public/sw-push.js.
      'packages/*/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        // `allowDefaultProject` : fichiers hors de tout tsconfig de package
        // (racine, `scripts/`, et côté packages les configs tailwind/postcss/
        // drizzle, absentes des `include`) — sans ça, `pnpm exec eslint
        // <fichier>` (utilisé tel quel par le hook pre-commit sur les fichiers
        // staged, contrairement à `just lint`/turbo qui ne scanne que
        // `packages/*/src`) plante en "Parsing error" dès qu'un de ces
        // fichiers est staged. `**` est refusé par typescript-eslint (perf),
        // d'où l'énumération `packages/*/`.
        //
        // N'élargir cette liste qu'aux fichiers réellement hors tsconfig :
        // typescript-eslint échoue en dur ("was included by allowDefaultProject
        // but also was found in the project service") sur un fichier listé ici
        // ET couvert par un tsconfig — c'est le cas de `vite.config.ts`,
        // `vitest.config.ts` (web) et `playwright.config.ts`, qui doivent donc
        // rester en dehors (ils gardent au passage le lint type-aware).
        //
        // `packages/backend/vitest.config.ts` est un cas à part : contrairement
        // à web (bundlé par Vite, `rootDir: "."`), le tsconfig backend a
        // `rootDir: "./src"` pour que `tsc` (build direct, pas de bundler)
        // produise `dist/index.js` et pas `dist/src/index.js` — l'y inclure
        // casserait le build avec une erreur TS6059 (fichier hors rootDir).
        // Listé ici explicitement (pas un glob `packages/*/vitest.config.*`,
        // qui matcherait aussi celui de web et retomberait dans le conflit
        // décrit ci-dessus).
        projectService: {
          allowDefaultProject: [
            '*.config.{js,ts,cjs,mjs}',
            'packages/*/{tailwind,postcss,drizzle}.config.{js,ts,cjs,mjs}',
            'packages/backend/vitest.config.ts',
            'scripts/*.mjs',
          ],
        },
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/require-await': 'warn',

      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          // Sans `import/resolver`, la règle ne sait pas résoudre l'alias `@/*`
          // (tsconfig paths) : elle le classait en groupe inconnu, trié APRÈS
          // les imports relatifs — l'inverse de la convention du dépôt (`@/`
          // avant `./`). `pathGroups` le rattache explicitement au groupe
          // `internal`, avant `parent`/`sibling`.
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'before' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-console': 'off',
    },
  },
  {
    // Même liste que `allowDefaultProject` ci-dessus : ces fichiers n'ont
    // pas de vraie info de types (pas dans un tsconfig de package), donc
    // les règles type-aware (no-unsafe-*, prefer-nullish-coalescing...) ne
    // peuvent pas fonctionner correctement dessus — certaines plantent même
    // en erreur dure (ex: prefer-nullish-coalescing exige strictNullChecks).
    files: [
      '*.config.{js,ts,cjs,mjs}',
      'packages/*/{tailwind,postcss,drizzle}.config.{js,ts,cjs,mjs}',
      'packages/backend/vitest.config.ts',
      'eslint.config.js',
      'scripts/*.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'import/order': 'off',
    },
  },
  prettier,
);
