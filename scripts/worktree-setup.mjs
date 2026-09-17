#!/usr/bin/env node
/**
 * Crée un worktree git prêt à l'emploi pour une branche de ticket.
 *
 * Un worktree neuf n'a ni `node_modules` ni `packages/shared/dist` : sans le
 * build de `@nexus/shared`, tout vitest de `@nexus/web` échoue à l'import,
 * ce qui coûte un aller-retour à chaque agent (constat de la fournée du
 * 2026-09-15, cf. `.agent/skills/parallel-ticket-fanout.md`). Ce script
 * enchaîne les trois étapes pour que le worktree soit vert dès la première
 * commande.
 *
 * Usage :
 *   node scripts/worktree-setup.mjs <branche> [base]
 *   just worktree bug/1234abcd-slug           # base = main
 *   just worktree feature/xyz origin/develop  # base explicite
 *
 * Le worktree est créé dans `<racine>/../nexus-worktrees/<branche avec / → ->`
 * (hors du dépôt, donc jamais vu par git status ni par les hooks). La branche
 * est créée depuis `origin/<base>` après un `git fetch`.
 */
/* eslint-disable no-console -- script CLI : la sortie console est son interface. */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const [branch, baseArg] = process.argv.slice(2);
if (!branch) {
  console.error('usage: node scripts/worktree-setup.mjs <branche> [base]');
  process.exit(2);
}
const base = baseArg ?? 'main';
const baseRef = base.startsWith('origin/') ? base : `origin/${base}`;

const run = (cmd, cwd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
};

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
// Un worktree répond aussi à --show-toplevel avec son propre chemin : on
// remonte au dépôt principal via le common dir pour ranger tous les
// worktrees au même endroit.
const commonDir = path.resolve(
  root,
  execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(),
);
const mainRoot = path.dirname(commonDir);
const dir = path.join(path.dirname(mainRoot), 'nexus-worktrees', branch.replaceAll('/', '-'));

if (existsSync(dir)) {
  console.error(`worktree déjà présent : ${dir}`);
  process.exit(1);
}

run('git fetch --quiet origin', mainRoot);
run(`git worktree add -b "${branch}" "${dir}" ${baseRef}`, mainRoot);
run('pnpm install --frozen-lockfile --prefer-offline', dir);
run('pnpm --filter @nexus/shared build', dir);

console.log(`\nWorktree prêt : ${dir}\nBranche : ${branch} (depuis ${baseRef})`);
