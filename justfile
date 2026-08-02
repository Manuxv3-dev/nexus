# Nexus — agrégateur de messageries + couche d'organisation
# Monorepo pnpm + Turborepo : backend, web, desktop, shared, platform, platform-web, landing
#
# Commandes courantes :
#   just install   - installe les dépendances
#   just verify    - les gates de qualité (lint + format + typecheck + test)
#   just test      - tests (accepte un filtre de package)
#   just dev       - stack de développement
#
# Voir 'just --list' pour tout.

# Sous Windows, just cherche `sh` par défaut, absent du PATH.
# On lui déclare PowerShell, présent partout. Sous Unix, le shell par défaut s'applique.
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Affiche les commandes disponibles
default:
    @just --list

# Les erreurs `command not found` sont la première cause d'échec sur ce dépôt.
# Cette recette les transforme en diagnostic explicite plutôt qu'en aller-retour.
# Vérifie que l'outillage attendu est présent et utilisable
[windows]
doctor:
    @$manquants = @(); foreach ($o in 'node','pnpm','git','gh','just','docker') { $p = (Get-Command $o -ErrorAction SilentlyContinue).Source; if ($p) { "  OK     {0,-12} {1}" -f $o, $p } else { "  MANQUE {0}" -f $o; $manquants += $o } }; $pc = (Get-Command pre-commit -ErrorAction SilentlyContinue).Source; if ($pc) { "  OK     {0,-12} {1}" -f 'pre-commit', $pc } else { $py = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'; if (Test-Path $py) { "  OK     {0,-12} via {1} -m pre_commit (hors PATH)" -f 'pre-commit', $py } else { "  MANQUE pre-commit  (pip install pre-commit)"; $manquants += 'pre-commit' } }; foreach ($o in 'cargo','rustc') { $p = (Get-Command $o -ErrorAction SilentlyContinue).Source; if ($p) { "  OK     {0,-12} {1}" -f $o, $p } else { "  ABSENT {0,-12} (requis seulement pour le desktop Tauri)" -f $o } }; $b = (Get-Command bash -ErrorAction SilentlyContinue).Source; if ($b -like '*System32*') { "  ALERTE bash pointe vers WSL ($b) -- les hooks .sh doivent viser Git Bash" }; if ($manquants.Count -gt 0) { "" ; "Manquant : $($manquants -join ', ')" ; exit 1 } else { "" ; "Tout est en place." }

# Vérifie que l'outillage attendu est présent et utilisable
[unix]
doctor:
    #!/usr/bin/env bash
    manquants=()
    for o in node pnpm git gh just docker pre-commit; do
      if [ "$o" = "pre-commit" ] && ! command -v pre-commit >/dev/null 2>&1 && python3 -c 'import pre_commit' 2>/dev/null; then
        printf "  OK     %-12s via python3 -m pre_commit (hors PATH)\n" "$o"; continue
      fi
      if p=$(command -v "$o" 2>/dev/null); then printf "  OK     %-12s %s\n" "$o" "$p"
      else printf "  MANQUE %s\n" "$o"; manquants+=("$o"); fi
    done
    for o in cargo rustc; do
      if p=$(command -v "$o" 2>/dev/null); then printf "  OK     %-12s %s\n" "$o" "$p"
      else printf "  ABSENT %-12s (requis seulement pour le desktop Tauri)\n" "$o"; fi
    done
    if [ ${#manquants[@]} -gt 0 ]; then printf "\nManquant : %s\n" "${manquants[*]}"; exit 1; fi
    printf "\nTout est en place.\n"

# Installe les dépendances (lockfile figé, comme en CI)
install:
    pnpm install --frozen-lockfile

# Le dépôt porte 114 warnings de style préexistants (import/order sur
# @nexus/web pour l'essentiel). La CI ne bloque que sur les erreurs. Le jour où
# ils sont résorbés, ajouter `--max-warnings 0` ici et dans le hook eslint.
# Lint
lint:
    pnpm lint

# Formate le dépôt (prettier --write)
format:
    pnpm format

# Vérifie le formatage sans rien réécrire (ce que fait le CI)
format-check:
    pnpm format:check

# Vérifie les types sur tous les packages
typecheck:
    pnpm typecheck

# Exemples :
#   just test
#   just test @nexus/backend
#   just test @nexus/shared
# Tests — accepte un filtre de package optionnel
test FILTRE="":
    {{ if FILTRE == "" { "pnpm test" } else { "pnpm --filter " + FILTRE + " test" } }}

# Les tests d'intégration backend skippent silencieusement sans Postgres joignable.
# Cette recette lève l'ambiguïté en démarrant la base d'abord.
# Tests backend avec Postgres réellement démarré
test-integration: compose-up
    pnpm --filter @nexus/backend test

# Gates bloquants avant tout commit
verify: lint format-check typecheck test

# Build de production de tous les packages
build:
    pnpm build

# Stack de développement (turbo watch sur tous les packages)
dev:
    pnpm dev

# Démarre Postgres 16 + Redis 7
compose-up:
    pnpm compose:up

# Arrête Postgres + Redis
compose-down:
    pnpm compose:down

# Suit les logs des services Docker
compose-logs:
    pnpm compose:logs

# Applique les migrations Drizzle
migrate:
    pnpm --filter @nexus/backend db:migrate

# Lance Tauri en développement (fenêtre native)
tauri-dev:
    pnpm tauri:dev

# Build le binaire Tauri
tauri-build:
    pnpm tauri:build

# Smoke test E2E contre la prod live (SMOKE_EMAIL / SMOKE_PASSWORD optionnels)
smoke:
    node scripts/smoke-test.mjs

# Si `pre-commit` n'est pas sur le PATH alors que Python l'a (cas Git Bash sur
# cette machine), utiliser directement :
#   "$LOCALAPPDATA/Programs/Python/Python313/python.exe" -m pre_commit install --install-hooks
# Installe les hooks de pre-commit dans .git/hooks/
hooks-install:
    pre-commit install --install-hooks
    pre-commit install --hook-type commit-msg

# Lance les hooks sur tout le dépôt
hooks-run:
    pre-commit run --all-files

# Lance les hooks sur l'index seulement
hooks-staged:
    pre-commit run

# Met à jour les hooks vers leurs dernières versions
hooks-update:
    pre-commit autoupdate

# Supprime les artefacts de build
[unix]
clean:
    rm -rf packages/*/dist packages/*/.turbo .turbo

# Supprime les artefacts de build
[windows]
clean:
    @foreach ($p in (Get-ChildItem -Path packages -Directory | ForEach-Object { Join-Path $_.FullName 'dist'; Join-Path $_.FullName '.turbo' }) + @('.turbo')) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
