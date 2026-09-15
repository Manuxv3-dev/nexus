# Skill — Fan-out parallèle de tickets Cortex (un worktree + un agent par ticket)

**Quand utiliser ce skill** : quand Manu demande de « paralléliser des agents
sur le plus de tickets possible », ou dès qu'au moins 3 tickets Cortex
indépendants, entièrement spécifiés, peuvent être exécutés en même temps.

Première exécution : 2026-09-15 — 12 tickets, 12 PR mergées le jour même,
une release desktop (`0.6.24`), 0 correction de Manu. Coût observé : ~$260
(orchestrateur Opus $145, agents Sonnet $115), 26 agents, 6 h. Ce skill
capitalise ce qui a marché et ce qui a coûté.

## 1. Sélection des tickets

Prendre : tickets `backlog` dont le « À faire » est exécutable sans question
(spec + fichiers cités), et **disjoints par fichiers**.

Écarter : accès VPS, `refine` nécessaire (« à trancher au refine »),
arbitrage produit, grosses features non planifiées, tickets qui touchent
les mêmes fichiers qu'un autre de la fournée (en garder un, l'autre suit).
Vérifier qu'aucune PR ouverte ne porte déjà le ticket (`gh pr list`,
`git branch -r`).

Passer chaque ticket retenu en `in_progress` (`mcp__cortex__save_issue`) —
l'orchestrateur tient Cortex, **pas les agents** (les agents ADLC n'ont pas
les outils MCP).

## 2. Worktrees

```bash
just worktree <type>/<id8>-<slug>        # un par ticket, depuis origin/main
```

Convention de branche : `bug/<id8>-<slug>`, `chore/<id8>-<slug>`,
`feature/<id8>-<slug>` (`id8` = 8 premiers caractères de l'id Cortex).
Les worktrees vont dans `../nexus-worktrees/`, hors du dépôt. Les agents
**peuvent écrire** dans ces worktrees frères (vérifié) — pas besoin
d'`isolation: "worktree"` par agent. Lancer les installs 3 par 3 (I/O).

## 3. Briefs partagés

Deux fichiers dans le scratchpad de session, lus en premier par chaque
agent. Les gabarits sont en annexe de ce skill — les recopier tels quels
et n'adapter que la date.

- `AGENT-BRIEF.md` — isolation, PATH, gates, commit/PR, rapport final.
- `REVIEW-BRIEF.md` — lecture seule stricte, quoi vérifier, **rapport court**.

Le prompt par ticket = « lis le brief » + texte intégral du ticket +
**décisions déjà tranchées par l'orchestrateur** (ne pas laisser un agent
rouvrir un arbitrage) + les fichiers que des voisins touchent en parallèle
+ le message de commit attendu + la ligne d'impact desktop.

Agents : `adlc-cortex:backend-engineer` / `frontend-engineer` /
`platform-engineer` selon le domaine (tournent sur **Sonnet**),
`run_in_background: true`, tous lancés dans un seul message.

## 4. Pendant l'exécution

- **Dès qu'une PR tombe** : Cortex `in_review` + commentaire (PR, SHA,
  décisions), puis dispatcher **immédiatement** `adlc-cortex:code-reviewer`
  avec `REVIEW-BRIEF.md` + points d'attention ciblés. Manu merge sur CI
  verte en quelques minutes : une revue lancée « après » arrive après le
  merge (3 fois sur 12 le 2026-09-15).
- **Label `needs-review`** posé par l'agent à `gh pr create
  --label needs-review`, retiré par l'orchestrateur (`gh pr edit N
  --remove-label needs-review`) une fois la revue passée et les retouches
  poussées. C'est le signal visible là où Manu merge.
- Dans chaque message d'état : lister explicitement les PR **mergeables**
  et celles qui **attendent** (revue ou commit d'agent).
- `main` bouge sous les agents (autres sessions, merges de la fournée) :
  quand un fichier d'un agent est touché sur `main`, lui envoyer
  (`SendMessage`) « `git fetch && git merge origin/main` » — merge, jamais
  rebase ni force-push — avec la liste des hunks à surveiller.
- Retours de revue → `SendMessage` à l'agent implémenteur avec les points
  numérotés, le commit attendu et « rapporte le SHA ». Une seconde passe de
  revue ciblée sur le delta pour auth / migrations / infra.
- Rapport de revue arrivé **après** le merge : ticketer les trouvailles dans
  Cortex, ne pas rouvrir.
- Limite d'API atteinte (agents « failed … rate_limit ») : après reset,
  `SendMessage` au même agentId avec l'état constaté du worktree (`HEAD`,
  fichiers modifiés non commités) — le transcript est intact, la reprise
  est propre.

## 5. Clôture

- Tickets `done` au merge ; tickets de suite créés pour chaque trouvaille
  de revue hors périmètre (avec la preuve et le correctif attendu).
- Release desktop **une fois le lot mergé** si une PR touche `@nexus/web`
  hors landing (cf. CLAUDE.md § Release desktop) — pas une par PR.
- Proposer le nettoyage des worktrees (`/adlc-cortex:clean-worktrees`),
  sans le faire d'office.
- Mettre à jour ce skill si un nouveau piège est apparu.

## 6. Coûts à surveiller

| Poste | Constat 2026-09-15 | Levier |
| --- | --- | --- |
| Rounds de retouche | 10 PR / 12 | `pre-pr-self-review.md` imposé dans le brief |
| Revues de diffs triviaux | reviewer complet (50–70 k tokens) sur +7/−3 | diff < 30 lignes → `/code-review low` par l'orchestrateur |
| Tours d'orchestration | 34 notifications, 23 `SendMessage`, 83 appels Cortex | rapports courts ; grouper les mises à jour Cortex |
| Échos `save_issue` | 44 × 2,3 KB de contexte mort | (ticket Cortex : réponses allégées) |
| Limite d'API | 25 agents Sonnet en 5 h → 5 tués | vagues de 6 ; reviewers légers sur le trivial |
| Scratchpad partagé | `commit-msg.txt` écrasé entre agents | noms suffixés par ticket (dans le brief) |

---

## Annexe A — `AGENT-BRIEF.md`

```markdown
# Brief commun — agents ticket Nexus (<date>)

Tu travailles pour Manu sur le monorepo **Nexus** (pnpm + Turborepo ;
`@nexus/backend` Fastify/Drizzle/Postgres/Redis/BullMQ ; `@nexus/web` React ;
`@nexus/desktop` Tauri 2 ; `@nexus/shared`). Tu es **un agent parmi N** qui
traitent chacun UN ticket Cortex en parallèle, chacun dans son propre git
worktree. Ton ticket, ton worktree et ta branche sont dans ton prompt.

## Règles d'isolation (non négociables)
- Uniquement dans ton worktree, chemins absolus. Jamais le checkout
  principal ni les autres worktrees.
- Jamais `git stash`, `git checkout`/`switch` d'une autre branche,
  `git worktree …`, `push --force`, rebase. Merge de `origin/main` seulement
  si l'orchestrateur le demande.
- Ne modifie pas `CLAUDE.md`, les ADR, la roadmap, les notes — sauf si le
  ticket le demande. Ne touche pas à Cortex.
- Fichiers temporaires (message de commit, body de PR) **suffixés par ton
  ticket** (`commit-msg-<id8>.txt`) : le scratchpad est partagé.

## Environnement (Git Bash) — à préfixer à CHAQUE commande Bash
export PATH="/c/Users/Manu/AppData/Roaming/npm:/c/Users/Manu/.cargo/bin:$PATH"
(`pnpm`, `just`, `cargo` hors PATH sinon ; les hooks git appellent
`pnpm exec`, donc aussi avant `git commit`.) Deps déjà installées, `@nexus/shared`
déjà buildé. Ne relance pas `pnpm install`.

## Avant de coder
1. Lis `CLAUDE.md` à la racine du worktree — il fait autorité.
2. Lis le code concerné **et ses tests** avant de modifier. Écris du code
   qui ressemble au code autour.
3. `feature`/`bug` : TDD (test rouge d'abord). `chore` : vérification seule.

## Gates — jamais de code rouge
- Dev : tests ciblés (`pnpm --filter @nexus/<pkg> test -- <fichier>`,
  `typecheck`, `lint`).
- Avant le commit final : `just verify` (timeout Bash 600000 ms — N agents
  tournent en même temps). Prettier se plaint → `just format`.
- Tests d'intégration backend (Postgres) **skippent en local** ; ils
  tournent en CI. Dis-le dans la PR ; lis le log du job pour confirmer.
- Interdits : `--no-verify` ; warning ESLint (sinon `eslint-disable-next-line`
  justifié) ; dépendance non vérifiée ; discord.js/baileys/mautrix/matrix
  sdk/@anthropic-ai/sdk/openai (ADR-027/032).
- JSDoc sur les exports non triviaux. Pas de TODO silencieux (signale la
  dette dans ton rapport). MVP, périmètre du ticket, rien de plus.

## Auto-revue avant la PR — OBLIGATOIRE
Déroule `.agent/skills/pre-pr-self-review.md` (4 points) et reporte la
ligne « Auto-revue : … » dans ton rapport.

## Commit
Conventional Commits en français, style du dépôt (`git log --oneline -15`).
Scopes usuels : backend, web, desktop, shared, auth, ci, adr. Sujet ≤ 80
caractères, lignes de body ≤ 100. Termine par une ligne vide puis
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Message multi-lignes
→ `git commit -F <fichier suffixé>`.

## Pull request
1. `git push -u origin <ta-branche>`
2. `gh pr create --base main --label needs-review --title "<sujet>" --body-file <fichier suffixé>`
3. Body en français, style maison (`gh pr view 98 --json body -q .body`) :
   `## Le bug` / `## Le point` — `## Le correctif` — `## Tests` (commandes
   exactes, ce qui n'a PAS été vérifié) — impact desktop (« touche
   `@nexus/web` → release à batcher » / « backend-only ») —
   `Fixes Cortex \`<id8>\`` — dernière ligne
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. `gh pr checks <num> --watch` (timeout 600000). Rouge → corrige, repush,
   max 3 itérations. Ne merge pas. Ne retire pas le label.

## Rapport final (structure fixe)
1. PR : URL + branche + SHA. 2. Ce qui a changé (3–6 lignes). 3. Décisions
prises. 4. Vérification (commandes + résultats ; non vérifié). 5. Auto-revue.
6. Dettes à ticketer. 7. Blocages.
```

## Annexe B — `REVIEW-BRIEF.md`

```markdown
# Brief commun — revue d'une PR Nexus (<date>)

## Règles strictes
- **Lecture seule.** Aucun fichier modifié/créé/supprimé dans le worktree
  ni ailleurs — pas même pour tester une hypothèse (raisonne, ou reproduis
  dans une copie sous ton scratchpad). Pas de stash/checkout/commit. Une
  revue qui a touché un fichier suivi est invalide.
- Commandes non mutantes autorisées : `git diff origin/main...HEAD`,
  `git log/show`, tests ciblés, `typecheck`, `lint`, `gh pr view/checks/diff`,
  `gh run view --log`. Préfixe PATH comme dans le brief agent.
- Tests Postgres : lire le log CI (`gh run view --job … --log`), vérifier
  qu'ils ont tourné (pas de « Postgres unavailable »).
- Ne poste rien sur GitHub, ne touche pas à Cortex.

## Ce que tu vérifies
`CLAUDE.md`, le diff complet, le code environnant nécessaire. Puis :
1. Correction vis-à-vis du ticket (tout, rien que ; cas limites ; client
   desktop figé). 2. Bugs réels (logique, concurrence, types menteurs, Zod
   aux frontières, a11y). 3. Tests : discriminent-ils (échoueraient sans le
   fix) ? 4. Sécurité/perf si la surface s'y prête — charge
   `reviewing-security` / `reviewing-performance` pour auth, migrations,
   chemins chauds, infra. 5. Conventions. 6. Le body dit-il la vérité ?

## Rapport — COURT, structure fixe
- **Verdict** : APPROUVER / APPROUVER AVEC RÉSERVES MINEURES / CHANGEMENTS REQUIS
- **⛔ Bloquants** / **⚠️ Importants** / **💡 Mineurs** : `fichier:ligne`,
  problème, pourquoi, correctif attendu. Sections vides omises.
- **Exécuté** : 3–5 lignes max (commandes + résultat).
- **Non vérifié** : 1–3 lignes.
Pas de tableau « réponses aux points du prompt », pas de section
« positive highlights », pas de récapitulatif métrique : l'orchestrateur ne
lit que les trouvailles. Le détail de tes vérifications va dans
`<scratchpad>/review-<num>-details.md` si tu veux le garder.
```
