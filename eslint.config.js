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
        // (racine ou `scripts/`) — sans ça, `pnpm exec eslint <fichier>`
        // (utilisé tel quel par le hook pre-commit sur les fichiers staged,
        // contrairement à `just lint`/turbo qui ne scanne que `packages/*`)
        // plante en "Parsing error" dès qu'un de ces fichiers est staged.
        projectService: { allowDefaultProject: ['*.config.{js,ts,cjs,mjs}', 'scripts/*.mjs'] },
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
    files: ['*.config.{js,ts,cjs,mjs}', 'eslint.config.js', 'scripts/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'import/order': 'off',
    },
  },
  prettier,
);
