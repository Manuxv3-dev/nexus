# ADR-036 : GlassDialogShell — adopter portal + `inert` pour la modalité (implémentation différée)

**Date** : 2026-08-11
**Statut** : Accepté (implémentation hors périmètre — cf. Suivi)

## Contexte

`GlassDialogShell` (ADR implicite de MAN-201, pas de numéro dédié à l'époque)
rend son overlay **sur place**, dans l'arbre React de l'appelant — pas via
`createPortal`. Le piège à focus (`useGlassDialogFocusTrap`, extrait en
MAN-241) compense par un listener `keydown`/`focusin` posé sur `document`, en
phase de capture, plutôt que de s'appuyer sur une vraie modalité DOM.

Relevé pendant la revue de MAN-201, formalisé pendant MAN-241 (migration des
6 derniers dialogues vers ce contrat) :

1. **Stacking context fragile.** `position: fixed` sur l'overlay se calcule
   contre le viewport SAUF si un ancêtre pose `transform`, `filter`,
   `backdrop-filter`, `contain` ou `perspective` — auquel cas `fixed` se
   recalcule contre CET ancêtre. Nexus utilise `backdrop-filter` massivement
   (`NX.glassBlur` sur chaque carte "glass", partout dans l'app). Rien
   n'empêche aujourd'hui un futur ancêtre du point de montage d'un dialogue
   de poser une de ces propriétés — le jour où ça arrive, l'overlay se
   retrouve confiné à la boîte de cet ancêtre au lieu de couvrir l'écran,
   silencieusement (pas d'erreur, juste un rendu cassé).
2. **`aria-modal="true"` ne suffit pas.** C'est un indice pour les
   technologies d'assistance, pas une garantie : il ne retire pas le
   contenu applicatif sous l'overlay de l'arbre d'accessibilité, ne bloque
   pas le "rechercher dans la page" (Ctrl+F) du navigateur, ne bloque pas
   les clics/le focus programmatique sur le contenu sous-jacent, et a des
   trous documentés sur Safari/VoiceOver (le contenu de fond reste
   atteignable au rotor). Le piège `document`-level de `GlassDialogShell`
   compense pour le clavier, mais rien ne compense pour le reste.
3. **`maxHeight: '100%'` plutôt que `100vh`** est déjà un contournement
   partiel du point 1 (cf. JSDoc `GlassDialogShell.tsx`) — la dépendance à
   la boîte réelle de l'overlay, plutôt qu'au viewport, disparaîtrait
   complètement si l'overlay était rendu directement sous `<body>`.

Un vrai `inert` posé sur la racine applicative pendant qu'un dialogue est
ouvert répond aux trois points à la fois — mais poser `inert` sur la racine
rendrait le dialogue lui-même inerte s'il reste un enfant de cette racine :
`inert` doit être posé sur les FRÈRES du dialogue dans le DOM, ce qui exige
que le dialogue soit rendu ailleurs — d'où `createPortal`.

## Recherche menée

Évaluation écrite uniquement (décision actée avec Manu en amont de
l'implémentation MAN-241 : le contexte technique ci-dessus est déjà
documenté, un spike de code jetable n'apportait pas d'information
supplémentaire pour trancher).

- **Précédent dans le repo** : `NotificationsBell.tsx` utilise déjà
  `createPortal` (vers `document.body`) pour son panneau positionné.
  Adopter le pattern ici est une généralisation, pas une nouveauté — aucune
  dépendance à ajouter (`createPortal` vient de `react-dom`, déjà présent).
- **Custom properties CSS** : `NX.glassBg`/`glassBlur`/etc. sont des
  `var(--nx-*)` (`packages/web/src/lib/tokens.ts`), définies sur `:root`
  (`packages/web/src/styles/tokens.css:23,310`), pas sur un conteneur
  scopé plus bas dans l'arbre. Un portail vers `document.body` reste un
  descendant de `:root` : aucune rupture de thème/variables à prévoir.
- **Arbre React vs arbre DOM** : un portail ne change QUE la position dans
  le DOM, pas dans l'arbre React — tout contexte React consommé par le
  contenu du dialogue (`useAuth`, `QueryClientProvider`, contexte de
  routeur) continue de fonctionner à l'identique. Idem pour le bubbling des
  événements synthétiques React, qui suit l'arbre React et non le DOM.
  Aucun risque identifié de ce côté.
- **Mécanique de piège à focus existante** : `useGlassDialogFocusTrap` pose
  déjà ses listeners sur `document`, pas sur un ancêtre scopé — la bascule
  vers un rendu portalé ne change RIEN à cette mécanique, seulement à
  l'endroit où le DOM du dialogue est monté. Migration additive, pas une
  réécriture du piège à focus.
- **Support navigateur de `inert`** : standard, supporté par tous les
  moteurs cibles actuels (Chromium/WebView2, WebKit/Safari, Gecko/Firefox)
  depuis 2022-2023 (Chrome 102 et Safari 15.5 en 2022, Firefox 112 en avril 2023) — même palier de support que `backdrop-filter`, déjà utilisé sans
  réserve dans tout le projet. `packages/desktop/src-tauri` ne fixe aucune
  version minimale de WebView2 dans sa configuration : l'app dépend du
  runtime installé sur la machine de l'utilisateur, auto-mis à jour par
  Windows/Edge dans l'immense majorité des cas. Risque résiduel jugé
  négligeable et du même ordre que celui déjà accepté pour
  `backdrop-filter`.
- **Compatibilité tests — correction post-revue** : jsdom **n'implémente
  PAS** la sémantique d'`inert` (vérifié empiriquement : `.focus()` réussit
  sur un élément dont un ancêtre porte `inert`, jsdom 30.0.1 — aucune trace
  d'`inert` dans `living/helpers/focusing.js` ni `HTMLElement-impl.js`).
  `el.closest('[inert]')` dans `isRenderedFocusable`
  (`GlassDialogShell.tsx`) est un simple sélecteur d'attribut CSS, qui
  fonctionne indépendamment de toute sémantique réelle — sa présence est
  d'ailleurs la preuve que jsdom ne fait PAS respecter `inert` nativement
  (sinon ce filtre manuel serait redondant). Aucun test actuel n'exerce la
  sémantique `inert`. **Conséquence pour le futur ticket d'implémentation** :
  toute assertion "le contenu de fond est inatteignable" sera vide de sens
  en jsdom — le ticket devra soit se limiter à vérifier le PLACEMENT de
  l'attribut `inert` sur les bons frères DOM (testable en jsdom), soit
  passer par Playwright pour vérifier la sémantique réelle (moteur de
  navigateur véritable). `document.body` reste un conteneur valide pour
  `createPortal` en environnement de test, ce point-là ne change pas.

## Décision

**Adopter portal + `inert`** pour `GlassDialogShell`/`useGlassDialogFocusTrap` :

- Le contenu du dialogue est rendu via `createPortal(…, document.body)`.
- Pendant qu'un dialogue est ouvert, les enfants directs de la racine
  applicative AUTRES que le nœud portalé reçoivent `inert` (implémentation :
  à documenter dans le ticket d'exécution — probable candidat : un id/ref
  stable sur le conteneur racine, dont on itère les enfants directs à
  l'ouverture, en excluant le conteneur du portail lui-même).
- `useGlassDialogFocusTrap` garde sa mécanique actuelle (listeners
  `document`, pile `openDialogStack`) — seul le point de montage du DOM
  change, pas le contrat de piège à focus/Escape/retour de focus déjà
  couvert par `GlassDialogShell.test.tsx`.
- `maxHeight: '100%'` peut revenir à une dépendance directe au viewport
  (`100dvh` plutôt que `100vh`, pour le repli des barres d'outils mobiles)
  une fois le rendu garanti hors de tout ancêtre à stacking context — à
  confirmer au moment de l'implémentation, pas une exigence de cet ADR.

**Implémentation différée** : ce ticket (MAN-241) se limite à l'évaluation et
à cette décision. L'implémentation — qui touche `GlassDialogShell` ET
`useGlassDialogFocusTrap`, donc les 10 dialogues qui en dépendent (les 4
d'origine + les 6 migrés ici) — part dans un ticket séparé, pour ne pas
mélanger un changement d'infrastructure partagée avec le travail mécanique
de migration de ce ticket-ci.

## Conséquences

### Positif

- Ferme les trois gaps documentés ci-dessus (stacking context,
  find-in-page/AT sur le contenu de fond, dépendance `100vh`) d'un seul
  coup, plutôt que de les traiter au cas par cas si/quand ils se
  matérialisent en bug de prod.
- Aucune nouvelle dépendance ; généralise un pattern déjà présent
  (`NotificationsBell.tsx`).
- Piège à focus/Escape/retour de focus inchangé — la surface de
  régression du futur ticket d'implémentation est le point de montage DOM
  et le calcul d'`inert` sur les frères, pas la mécanique déjà testée.

### Négatif

- Touche un composant partagé consommé par 10 dialogues (4 MAN-201 + 6
  MAN-241) — surface de test de non-régression large pour le futur ticket
  d'implémentation, malgré le risque technique jugé faible ci-dessus.
- Le calcul de quels frères DOM rendre `inert` dépend de la structure de la
  racine applicative au moment de l'implémentation — pas figé par cet ADR,
  à concevoir dans le ticket dédié.

### Neutre

- Ne change rien à l'usage de `GlassDialogShell`/`useGlassDialogFocusTrap`
  côté appelants (mêmes props, même contrat) — migration interne au shell,
  invisible depuis les 10 sites d'appel.

## Suivi

- Réf. Cortex : MAN-241 (ticket source de cette évaluation).
- Ticket d'implémentation séparé à créer (hors périmètre de MAN-241) : bascule
  `GlassDialogShell`/`useGlassDialogFocusTrap` vers `createPortal` +
  calcul d'`inert` sur les frères de la racine, avec re-vérification des 10
  dialogues consommateurs (les 4 de MAN-201 + les 6 de MAN-241).
