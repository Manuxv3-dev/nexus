# Skill — Auto-revue avant d'ouvrir une PR

**Quand utiliser ce skill** : juste avant `gh pr create` (ou `gh pr edit`
après une retouche), pour toute PR — feature, bug ou chore. Cinq minutes qui
évitent un round de revue.

## Pourquoi

Sur la fournée du 2026-09-15 (12 PR livrées en parallèle, toutes revues par
un agent avant merge), **10 PR sur 12** ont eu un round de retouche, et les
retours se rangeaient dans quatre familles **prévisibles** :

| Famille | Occurrences | Exemple réel |
| --- | --- | --- |
| Commentaire / doc / test rendu faux par le diff | 3 PR | « l'assistant 3 étapes (avatar → …) » après retrait de l'étape avatar (#102) ; trois « tombstones » racontant un alias retiré (#105) |
| Test qui ne pinne pas le comportement annoncé | 4 PR | l'effet `useEffect` de #104 pouvait être supprimé sans faire rougir la suite ; un `rerender` avec un second `QueryClient` (#103) ; branche perdante d'un claim jamais exercée (#110) |
| Body de PR qui affirme plus que ce qui a été vérifié | 4 PR | « échec d'enqueue → warn, jamais bloquant » alors que `queue.add()` pend sans Redis (#108) ; « 13 cas » pour 8 nouveaux (#110) |
| Narratif du ticket repris sans vérification dans le code | 2 PR | « la cloche produit un deep-link sondage » — aucun kind de `KIND_TO_PANE` ne mappe vers `poll` (#103) |

Chaque round coûte un cycle agent complet (50–150 k tokens) plus un tour
d'orchestration. La checklist ci-dessous ferme ces quatre familles à la
source.

## Checklist (à dérouler, pas à survoler)

### 1. Ce que j'ai retiré ou renommé n'est plus mentionné nulle part

```bash
# pour chaque symbole, libellé, étape, fichier ou concept retiré/renommé :
git grep -n -i "<ancien nom>" -- ':!pnpm-lock.yaml'
```

Cible : commentaires, JSDoc, en-têtes de tests, specs e2e, `docs/`,
`.agent/`, `CLAUDE.md`. Un commentaire qui décrit l'ancien monde est un bug
de maintenabilité : on le corrige dans la même PR, pas « plus tard ».

### 2. Chaque test ajouté échoue sans le correctif

Pour **chaque** `it(` ajouté ou modifié :

```bash
git stash push -m "self-review <ticket>" -- <fichier(s) de prod du fix>
pnpm --filter <pkg> test -- <fichier de test>      # doit être ROUGE
git stash pop
pnpm --filter <pkg> test -- <fichier de test>      # doit être VERT
```

(En worktree partagé, préférer `git stash push -m "<tag unique>"` puis
`git stash apply <sha>` — cf. règles du dépôt sur le stash partagé.)

Cas typiques qui passent « vert des deux côtés » et ne prouvent rien :

- un effet (`useEffect`) doublé par une condition de rendu — le test doit
  observer ce que **seul** l'effet produit ;
- une assertion `expect(rows[0]?.x)` sur un tableau potentiellement vide —
  ajouter `expect(rows).toHaveLength(1)` avant ;
- un mock dont le stub ne reproduit pas le comportement réel de la lib (un
  `mockRejectedValue` ne prouve pas qu'un `add()` réel rejette) ;
- un `rerender` qui recrée un `QueryClient`/store au lieu de réutiliser
  celui du premier rendu.

Si le test ne peut pas tourner en local (Postgres), le dire dans le body et
s'appuyer sur le job CI — mais le raisonnement « échouerait sans le fix »
doit quand même être écrit.

### 3. Le body ne promet que ce qui a été exécuté

- Chaque affirmation de vérification est une commande que j'ai lancée, avec
  son résultat. « CI verte » ≠ « les tests d'intégration ont tourné » : lire
  le log du job pour confirmer que la suite n'a pas skippé.
- Pas de superlatif sur un mécanisme non testé (« retry robuste », « jamais
  bloquant », « no-op idempotent ») sans en avoir lu le code source de la
  lib ou l'avoir sondé.
- Les nombres (tests ajoutés, fichiers migrés) sont comptés, pas estimés.
- Ce qui **n'a pas** été vérifié est listé explicitement.

### 4. Le narratif du ticket est vérifié avant d'être repris

Un ticket peut se tromper sur la cause ou le chemin (« relevé en revue »,
« probablement »). Avant d'écrire « avant ce fix, X faisait Y » dans le
body, un commentaire ou un en-tête de test : `git grep` / lecture du code
pour confirmer que X existe et fait Y. Si le ticket a tort, le dire dans le
body — c'est une information utile, pas une critique.

### 5. Hygiène finale

- `git diff origin/main...HEAD --stat` : aucun fichier hors périmètre, aucun
  reformatage massif, aucun fichier temporaire.
- Sujet de commit ≤ 80 caractères, body ≤ 100 caractères par ligne
  (commitlint refuse au-delà — y compris la ligne `Co-Authored-By`).
- Si un autre agent travaille en parallèle sur un fichier voisin : mon diff
  y reste minimal et localisé.

## Sortie attendue

Dans le rapport à l'orchestrateur (ou le body de PR), une ligne :

> Auto-revue : 1 ✔ (grep `<terme>` → 0 résidu) · 2 ✔ (N tests rouges sans
> le fix) · 3 ✔ · 4 ✔ (ticket exact / ticket corrigé sur « … »)

Un ✘ est acceptable s'il est justifié (« 2 ✘ : test d'intégration, vérifié
en CI seulement — job `Test (Postgres)` lu, 45 tests exécutés »).
