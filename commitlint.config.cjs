/**
 * Conventional Commits — règles pour Nexus.
 * Format : type(scope?): subject
 *
 * Exemples :
 *   feat(backend): add /auth/login endpoint
 *   fix(desktop): handle WS reconnect on token refresh
 *   chore: bump deps
 *   docs(adr): accept ADR-011
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // nouvelle fonctionnalité
        'fix', // bug fix
        'docs', // documentation, ADR, README
        'style', // formatting, pas de changement de logique
        'refactor', // refacto sans changement comportemental
        'perf', // amélioration de perf
        'test', // ajout/maj de tests
        'build', // build system, deps
        'ci', // CI / GitHub Actions
        'chore', // tâches diverses
        'revert', // revert d'un commit
      ],
    ],
    'scope-enum': [
      1,
      'always',
      [
        'backend',
        'desktop',
        'mobile',
        'shared',
        'discord',
        'whatsapp',
        'messenger',
        'auth',
        'ws',
        'db',
        'orga',
        'public-pages',
        'ai',
        'ci',
        'deps',
        'adr',
        'agent',
        'monorepo',
      ],
    ],
    'subject-max-length': [2, 'always', 80],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
