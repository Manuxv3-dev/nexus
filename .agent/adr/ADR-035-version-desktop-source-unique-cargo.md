# ADR-035 : Version desktop — Cargo.toml comme source unique (supersède la table de bump d'ADR-031)

**Date** : 2026-08-03
**Statut** : Accepté

## Contexte

ADR-031 (pipeline de release desktop) documentait un bump manuel synchronisé
dans 3 fichiers :

| Fichier                                      | Champ             |
| -------------------------------------------- | ----------------- |
| `packages/desktop/package.json`              | `version`         |
| `packages/desktop/src-tauri/Cargo.toml`      | `package.version` |
| `packages/desktop/src-tauri/tauri.conf.json` | `version`         |

Rien ne garantissait cette synchronisation : pas de script de bump, pas de
check CI, et la version affichée nulle part dans l'UI (aucun moyen de
vérifier depuis l'app elle-même quelle version tournait réellement). En
creusant le sujet (MAN-132, "afficher et gérer la version de Nexus"),
plusieurs constats :

- `packages/desktop/src-tauri/Cargo.lock` avait déjà dérivé (`0.0.0` au lieu
  de `0.2.1`) — la synchronisation manuelle avait déjà échoué une fois, sans
  que personne ne le remarque (fichier gitignored, jamais vu en revue).
- Le schéma Tauri v2 documente que `tauri.conf.json`.`version`, quand
  présent, **prend le dessus** sur `Cargo.toml` au build — donc la
  duplication n'est pas neutre : une valeur périmée dans `tauri.conf.json`
  gagnerait silencieusement, même si `Cargo.toml` était correct.
- `getVersion()` (`@tauri-apps/api/app`), maintenant affichée dans
  Settings (MAN-134), renvoie la valeur réellement compilée dans le binaire
  — c'est la définition même de "ce qui tourne", pas une copie.

## Options envisagées

1. **Garder les 3 fichiers synchronisés à la main, ajouter un script de
   bump** (`just bump-version`) — réduit le risque d'erreur _si_ le script
   est utilisé, mais rien n'empêche une édition directe d'un seul fichier
   (exactement ce qui a produit la dérive de `Cargo.lock`).
2. **Garder les 3 fichiers, ajouter uniquement un garde-fou CI** qui compare
   les 3 valeurs avant de publier une release — bloque la publication d'une
   version incohérente, mais laisse la duplication elle-même en place : la
   documentation continue de dire "éditer 3 fichiers", donc le risque
   d'oubli reste entier à chaque bump, le CI ne faisant que le détecter
   après coup.
3. **Supprimer la duplication à la source** : retirer le champ `version` de
   `tauri.conf.json` (Tauri hérite alors de `Cargo.toml` au build, comportement
   documenté par son propre schéma) + garde-fou CI qui vérifie en plus que
   `tauri.conf.json` ne redéclare pas `version`. `package.json` reste un
   troisième fichier, mais purement informatif (rien ne le lit pour
   déterminer l'identité de l'app en prod) — vérifié par CI par convention,
   pas parce qu'il est fonctionnellement critique.

## Décision

Option 3, implémentée en MAN-134 :

- **`Cargo.toml` est l'unique source fonctionnellement critique** de la
  version desktop — c'est ce que le binaire compile, ce que `getVersion()`
  renvoie, et donc ce qui doit gouverner.
- **`tauri.conf.json` ne déclare plus de `version` propre.** Un garde-fou CI
  (`check-version`, `.github/workflows/desktop-release.yml`) échoue la
  release si ce champ est réintroduit, pour empêcher qu'une valeur y
  redevienne silencieusement prioritaire sur `Cargo.toml`.
- **`package.json` reste à jour par convention**, vérifié par le même
  garde-fou CI (comparaison au tag `desktop-v*`), sans être une source
  fonctionnelle : rien dans la chaîne de build ou l'app installée ne le lit.
- **Déviation assumée de la recommandation Tauri par défaut** : le schéma de
  `tauri.conf.json` suggère de gérer la version _dans_ ce fichier. Choix
  délibéré ici, pour ancrer la version sur ce qui est réellement compilé
  plutôt que sur une déclaration parallèle — à ne pas "corriger" en sens
  inverse sans repasser par un nouvel ADR.
- **Procédure de bump mise à jour** : éditer `Cargo.toml`, éditer
  `package.json` pour cohérence documentaire, tagger `desktop-vX.Y.Z`. Le
  garde-fou CI refuse le build si l'un des deux ne correspond pas au tag, ou
  si le tag ne cible pas un vrai tag `desktop-v*` (bloque aussi un
  `workflow_dispatch` accidentellement lancé sur une branche).

## Conséquences

### Positif

- Un seul fichier fonctionnellement critique à éditer au bump (`Cargo.toml`)
  au lieu de trois à garder synchronisés à la main.
- La dérive qui a déjà eu lieu une fois (`Cargo.lock`) ne peut plus se
  reproduire silencieusement : soit la duplication n'existe plus
  (`tauri.conf.json`), soit elle est vérifiée en CI avant publication
  (`package.json`).
- La version affichée dans l'app (Settings, MAN-134) est garantie exacte par
  construction — elle vient de `getVersion()`, pas d'un fichier qu'on espère
  à jour.

### Négatif

- Dévie de la pratique par défaut de Tauri. Un futur upgrade majeur de Tauri
  devra revérifier que le comportement d'héritage `tauri.conf.json` ←
  `Cargo.toml` (absence de champ `version`) reste stable dans les release
  notes.
- `package.json` reste un troisième fichier à maintenir manuellement pour la
  cohérence documentaire, même s'il n'est plus fonctionnellement critique —
  option non retenue de le supprimer purement, car des outils npm/pnpm
  externes (registries, dashboards) peuvent s'attendre à un champ `version`
  présent et non vide.

### Neutre

- ADR-031 reste valide pour tout le reste (choix code-signing, distribution
  GitHub Releases, auto-update Tauri natif, structure du pipeline CI) — seule
  sa section "Versions" (table de bump à 3 fichiers) est remplacée par cette
  décision.

## Suivi

- Réf. Linear : MAN-132 (parent), MAN-133 (identifiant de build web),
  MAN-134 (implémentation de cette décision), MAN-135 (cet ADR).
- Si un futur besoin de version sémantique pour `@nexus/web` ou les autres
  packages émerge (aujourd'hui `0.0.0` partout, sans signification), il fera
  l'objet d'un ADR séparé — hors périmètre ici (cf. Out of Scope de MAN-132).
