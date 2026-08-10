/**
 * GlassDialogShell — panneau modal "glass" partagé (MAN-201).
 *
 * Extrait de la copie quasi-identique répétée dans `TransferOwnershipDialog`,
 * `RemoveMemberDialog`, `LeaveGroupDialog` (`screens/app/GroupMembersPanel.tsx`)
 * et `ConfirmGroupActionDialog` (`screens/app/GroupMenu.tsx`) : overlay flou +
 * carte "glass" (`NX.glassBg`/`glassBlur`/`glassBorder`/`glassShadow`). Ce
 * composant ne porte AUCUNE logique métier — chaque appelant garde ses
 * propres mutations/actions, seul le chrome visuel + l'accessibilité sont
 * mutualisés. `GlassDialogActions`/`GlassDialogDescription`/
 * `GlassDialogSecondaryButton`/`GlassDialogPrimaryButton` ci-dessous
 * mutualisent en plus les sous-parties elles-mêmes dupliquées à l'identique
 * dans les quatre appelants (rangée de CTA, paragraphe de description, style
 * des deux familles de bouton).
 *
 * `useGlassDialogFocusTrap` (MAN-241) : le piège à focus/Escape/retour de
 * focus ci-dessous est extrait en hook réutilisable, PAS spécifique au rendu
 * de ce composant. Raison : `InviteDialog`/`ConfirmDisconnectModal` (carte
 * titre+description+actions simple) rentrent dans le gabarit de ce shell,
 * mais `EventModal`/`ExpenseModal`/`PollModal`/`TodoListModal` ont un chrome
 * structurellement différent (header icône+titre+sous-titre, corps
 * scrollable indépendant, footer épinglé — `padding:0` sur la carte plutôt
 * que le `padding:24` fixe ci-dessous, un seul `<h2>` ne suffit pas). Plutôt
 * que de complexifier ce composant avec des props de layout (padding
 * configurable, slot de header custom) pour absorber un second gabarit,
 * `useGlassDialogFocusTrap` expose la mécanique invisible seule (piège à
 * focus, Escape, retour de focus, pile de dialogues) — `GlassDialogShell`
 * l'utilise pour SON rendu ci-dessous, ces quatre modaux l'utilisent
 * directement sur LEUR propre markup, inchangé.
 *
 * Contrat d'accessibilité (porté par le hook) :
 *  - `role="dialog"` + `aria-modal="true"` sur l'overlay, `aria-labelledby`
 *    pointant vers le titre (id généré via `useId`, l'appelant n'a plus à le
 *    gérer lui-même) ;
 *  - **focus trap au niveau `document`, pas React** : `Tab`/`Shift+Tab`/
 *    `Escape` sont interceptés par un listener `keydown` posé sur `document`
 *    en phase de capture, PAS par un `onKeyDown` React sur l'overlay. Un
 *    `onKeyDown` React ne reçoit que les événements dont la cible est un
 *    DESCENDANT du nœud — or dès que `document.activeElement` devient
 *    `<body>` (un CTA qui passe `disabled` natif pendant une mutation se
 *    fait "blur" par le navigateur vers `body`, qui N'EST PAS un descendant
 *    de l'overlay), plus aucun `keydown` n'atteint un handler React posé
 *    dessus : ni `Tab` ni `Escape` ne sont plus interceptés, et le `Tab`
 *    natif du navigateur part dans le contenu applicatif sous l'overlay.
 *    Vérifié en revue MAN-201 (C1) contre les quatre appelants : c'est
 *    exactement ce qui se produit à chaque CTA `disabled={busy}` pendant sa
 *    mutation, à chaque changement d'étape qui démonte le dernier élément
 *    focusé (`TransferOwnershipDialog`), et sur le chemin d'erreur de
 *    `LeaveGroupDialog`. Un listener `document` (capture) reçoit l'événement
 *    QUELLE QUE SOIT sa cible, y compris `body` ;
 *  - **garde-fou `focusin`** : en plus du `keydown`, un listener `focusin`
 *    sur `document` ramène immédiatement le focus dans la carte s'il en sort
 *    par un autre chemin que `Tab` (ex. un appel `.focus()` externe, ou tout
 *    scénario non couvert par le `keydown` seul) ;
 *  - **une seule pile ouverte à la fois** : ces deux listeners `document`
 *    ne réagissent que si CETTE instance est au sommet d'une pile
 *    module-level `openDialogStack` — nécessaire dès qu'un jour deux shells
 *    seraient montés simultanément (aucun appelant actuel ne le fait), pour
 *    qu'`Escape` ne ferme que le dialog du dessus plutôt que toute la pile ;
 *  - au montage, le focus va au premier élément focusable de la carte (la
 *    carte elle-même, `tabIndex={-1}`, en dernier recours si aucun élément
 *    focusable n'est trouvé, OU si le focus n'a de fait pas pris sur la
 *    cible visée — cf. `getFocusableElements`/M2 ci-dessous, un élément peut
 *    matcher le sélecteur CSS sans être réellement focusable, ex. descendant
 *    de `<fieldset disabled>`) ;
 *  - à la fermeture (démontage), le focus revient sur l'élément qui l'avait
 *    avant l'ouverture — SAUF si celui-ci vaut `document.body` (jamais un
 *    vrai "précédent focus" : c'est ce que devient `activeElement` quand
 *    l'élément qui avait le focus a été retiré du DOM entre-temps, ex. un
 *    menu qui se ferme dans le même commit que l'ouverture du dialog) ou
 *    s'il a lui-même été retiré du DOM pendant que le dialog était ouvert
 *    (ex. la ligne d'un membre retiré avec succès). Dans ces deux cas,
 *    `returnFocusRef` (si fourni par l'appelant) sert de repli vers un
 *    élément dont la survie est garantie par construction ;
 *  - **Escape** ferme le dialog, sauf si `closeDisabled` (ex. mutation en
 *    cours — même garde-fou que le clic sur l'overlay). Les CTA internes
 *    (Annuler/Confirmer) gèrent leur propre `disabled`/`aria-disabled`
 *    indépendamment de cette prop.
 *
 * Comportement responsive (MAN-201, propre au rendu de CE composant, pas au
 * hook) :
 *  - la carte est `width: 100%` de l'espace intérieur de l'overlay (un
 *    conteneur flex, `display:flex;alignItems:center;justifyContent:center`,
 *    c'est LUI qui contraint la largeur disponible via son propre `padding`
 *    — le `box-sizing` de la carte n'y est pour rien), plafonnée à
 *    `maxWidth` (440px par défaut) seulement au-delà. Ce point n'est PAS un
 *    changement MAN-201 : les quatre originaux avaient déjà exactement ce
 *    calcul, il est seulement centralisé ici ;
 *  - `max-height: 100%` + `overflow-y: auto` sur la carte (100% de la boîte
 *    de l'overlay, pas un `100vh` codé en dur : les deux coïncident dans le
 *    cas normal, mais `100vh` ignore le repli des barres d'outils mobiles à
 *    la volée, et un `position:fixed` peut se recalculer contre un ancêtre
 *    plutôt que le viewport dès qu'un ancêtre pose `transform`/`filter`/
 *    `backdrop-filter`/`contain` — plausible ici vu le nombre de
 *    `backdrop-filter` en jeu. `100%` reste juste dans les deux cas car il
 *    suit la boîte réelle de l'overlay) : un contenu plus grand que l'écran
 *    (ex. le `<select>` de `TransferOwnershipDialog`) scrolle DANS la carte ;
 *  - `GlassDialogActions` empile ses enfants en colonne inversée sous le
 *    breakpoint mobile (CTA principal visuellement en haut, largeur pleine
 *    via le comportement `align-items: stretch` par défaut de flex) plutôt
 *    que de les garder sur une seule ligne — la rangée `flex, gap, justify-
 *    content: flex-end` d'origine, sans `flex-wrap`, débordait horizontale-
 *    ment à 320px dès qu'un CTA grossissait pour la cible tactile 44px
 *    (`useDialogCtaSize`) ; empiler élimine la contrainte de largeur plutôt
 *    que de la déplacer.
 */
import * as React from 'react';

import { NX } from '@/lib/tokens';
import { useIsMobile } from '@/lib/useMedia';

import type { ButtonSize } from './Button';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Filtre les faux positifs du sélecteur ci-dessus, purement attributaire :
 * un `[disabled]`/`input[type="hidden"]` est déjà exclu par le sélecteur,
 * mais rien n'y détecte un `display:none`/`visibility:hidden` (CSS), un
 * `inert` porté par un ANCÊTRE (l'attribut peut ne pas être posé sur
 * l'élément lui-même), ou un descendant de `<fieldset disabled>` (la
 * désactivation s'y propage sans poser l'attribut `disabled` sur chaque
 * enfant).
 *
 * Volontairement PAS `offsetParent`/`getClientRects()` (le choix le plus
 * courant pour ce genre de filtre) : ce projet teste en jsdom, qui ne fait
 * aucune mise en page — les deux valent systématiquement "invisible" même
 * pour un élément réellement affiché, ce qui casserait silencieusement
 * TOUTES les assertions de focus de `GlassDialogShell.test.tsx`, dans ce
 * fichier et dans les tests des quatre appelants. `getComputedStyle` reste
 * fiable sans mise en page (styles inline/CSSOM), et le cas
 * `fieldset[disabled]` est vérifiable en jsdom : `.focus()` y échoue
 * réellement (jsdom implémente cette désactivation-là nativement), ce qui
 * rend le test correspondant non-vacueux.
 */
function isRenderedFocusable(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  if (el.closest('fieldset[disabled]')) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isRenderedFocusable,
  );
}

/**
 * Pile module-level des instances de piège-à-focus actuellement montées
 * (via `GlassDialogShell` OU directement via `useGlassDialogFocusTrap`),
 * dans l'ordre de montage. Aucun appelant actuel n'ouvre deux dialogs
 * simultanément, mais les listeners `document` (keydown/focusin) sont
 * partagés par nature — sans cette pile, deux instances monteraient chacune
 * leur propre listener et réagiraient TOUTES les deux au même `Escape`,
 * fermant potentiellement plus que le dialog du dessus. `isTopmost`
 * restreint chaque instance à n'agir que si elle est la dernière montée.
 */
const openDialogStack: symbol[] = [];

function isTopmost(id: symbol): boolean {
  return openDialogStack[openDialogStack.length - 1] === id;
}

export interface UseGlassDialogFocusTrapOptions {
  /**
   * Fermeture demandée par l'utilisateur (Escape). N'est PAS appelé quand
   * `closeDisabled` est vrai — à l'appelant de fermer lui-même via son
   * propre bouton une fois la mutation terminée si besoin.
   */
  onClose: () => void;
  /** Désactive la fermeture par Escape (ex. mutation en cours). Défaut `false`. */
  closeDisabled?: boolean;
  /**
   * Élément vers lequel rendre le focus à la fermeture si l'élément
   * précédemment focusé n'est plus disponible — cf. JSDoc de fichier pour le
   * détail (menu qui se ferme dans le même commit que l'ouverture, ligne
   * retirée du DOM pendant que le dialog était ouvert, etc.).
   */
  returnFocusRef?: React.RefObject<HTMLElement> | undefined;
}

export interface GlassDialogFocusTrap {
  /** À poser en `id` sur l'élément de titre visible, et en `aria-labelledby` sur l'overlay `role="dialog"`. */
  titleId: string;
  /** À poser en `ref` sur le conteneur focus-trappé (la carte) — doit aussi porter `tabIndex={-1}`. */
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Mécanique invisible d'un dialogue modal "glass" — piège de focus au niveau
 * `document`, retour de focus, fermeture Escape, pile de dialogues — SANS
 * aucun rendu. Cf. JSDoc de fichier pour le détail du contrat et pourquoi
 * cette mécanique est un hook plutôt qu'intégrée uniquement à
 * `GlassDialogShell` : `EventModal`/`ExpenseModal`/`PollModal`/
 * `TodoListModal` (MAN-241) ont un chrome visuel incompatible avec la carte
 * unique de ce composant, mais ont besoin exactement de cette mécanique.
 */
export function useGlassDialogFocusTrap({
  onClose,
  closeDisabled = false,
  returnFocusRef,
}: UseGlassDialogFocusTrapOptions): GlassDialogFocusTrap {
  const titleId = React.useId();
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Identité stable pour toute la durée de vie de l'instance, utilisée par
  // `openDialogStack`/`isTopmost` — initialisée une seule fois (pattern de
  // lazy-init par ref, `Symbol()` n'a pas d'effet de bord donc l'appeler
  // plusieurs fois en dev/StrictMode ne pose pas de problème, seule la
  // première valeur assignée compte).
  const instanceIdRef = React.useRef<symbol | null>(null);
  instanceIdRef.current ??= Symbol('glass-dialog');
  const instanceId = instanceIdRef.current;

  // Toujours à jour sans réabonner les listeners `document` (effets à
  // `[instanceId]`, cf. plus bas) : lues au moment de l'événement, pas
  // capturées une fois pour toutes à l'abonnement.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = React.useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  React.useEffect(() => {
    openDialogStack.push(instanceId);

    // M1 : `document.activeElement` n'est jamais `null` — quand l'élément
    // qui avait le focus est retiré du DOM, il devient `document.body`, qui
    // EST une `HTMLElement`. Sans ce rejet explicite, `previouslyFocused`
    // vaudrait `document.body`, `document.contains(document.body)` est
    // toujours vrai, et `document.body.focus()` ne fait rien : le focus se
    // perd silencieusement plutôt que d'échouer bruyamment.
    const activeAtMount = document.activeElement;
    const previouslyFocused =
      activeAtMount instanceof HTMLElement && activeAtMount !== document.body
        ? activeAtMount
        : null;

    const container = cardRef.current;
    // M3 (MAN-241, revue) : un enfant du contenu peut déjà porter `autoFocus`
    // (ex. le champ "Titre" des 4 modaux-formulaires EventModal/ExpenseModal/
    // PollModal/TodoListModal en mode create/edit). React applique `autoFocus`
    // pendant la phase de commit — donc AVANT que cet effet passif (`useEffect`)
    // ne s'exécute. Sans ce garde-fou, l'effet écraserait systématiquement ce
    // focus par le premier élément focusable de la carte (souvent le bouton
    // ✕ du header, qui précède le corps dans le DOM) : une régression, pas
    // une simple absence d'amélioration.
    if (container && !(activeAtMount instanceof HTMLElement && container.contains(activeAtMount))) {
      const focusables = getFocusableElements(container);
      const target = focusables[0] ?? container;
      target.focus();
      // M2 : un élément peut matcher `getFocusableElements` sans être
      // RÉELLEMENT focusable pour une raison qu'on n'a pas détectée
      // statiquement (ex. un ancêtre qu'on n'a pas anticipé) — vérifier que
      // `.focus()` a réellement pris plutôt que de faire confiance au
      // sélecteur, et replier sur la carte sinon.
      if (document.activeElement !== target) container.focus();
    }

    return () => {
      const idx = openDialogStack.indexOf(instanceId);
      if (idx !== -1) openDialogStack.splice(idx, 1);

      const stillThere = (el: HTMLElement | null | undefined): el is HTMLElement =>
        el != null && document.contains(el);

      const restoreTo = stillThere(previouslyFocused)
        ? previouslyFocused
        : stillThere(returnFocusRef?.current)
          ? returnFocusRef.current
          : null;
      restoreTo?.focus();
    };
    // `returnFocusRef` est un objet stable créé par l'appelant (`useRef`) :
    // le lire au démontage via la closure ci-dessus reflète déjà sa valeur
    // COURANTE (`.current` est une case mutable, pas capturée par valeur) —
    // pas besoin de le lister en dépendance pour rester à jour.
  }, [instanceId]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isTopmost(instanceId)) return;

      if (e.key === 'Escape') {
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const container = cardRef.current;
      if (!container) return;
      const focusables = getFocusableElements(container);
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) {
        // Rien de focusable dans la carte : garde le focus dessus plutôt
        // que de laisser Tab s'échapper vers le contenu applicatif.
        e.preventDefault();
        container.focus();
        return;
      }

      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
          if (document.activeElement !== last) container.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
        if (document.activeElement !== first) container.focus();
      }
    }

    // Capture, pas bubble : un `keydown` dont la cible est `document.body`
    // (cf. JSDoc de fichier, C1) n'a de toute façon aucun ancêtre par lequel
    // "bubbler" avant `document` — la phase ne change rien pour CE cas
    // précis, mais la capture garantit qu'on voit l'événement avant qu'un
    // handler intermédiaire ne l'intercepte (`stopPropagation`) pour un
    // focus, lui, normalement situé dans l'arbre.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [instanceId]);

  React.useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (!isTopmost(instanceId)) return;
      const container = cardRef.current;
      if (container && e.target instanceof Node && !container.contains(e.target)) {
        const focusables = getFocusableElements(container);
        (focusables[0] ?? container).focus();
      }
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [instanceId]);

  return { titleId, containerRef: cardRef };
}

export interface GlassDialogShellProps {
  /** Rendu dans le `<h2>` de titre, source de l'`aria-labelledby` de l'overlay. */
  title: React.ReactNode;
  /**
   * Fermeture demandée par l'utilisateur (clic sur l'overlay ou `Escape`).
   * N'est PAS appelé quand `closeDisabled` est vrai — à l'appelant de fermer
   * lui-même via son propre bouton "Annuler"/"Fermer" une fois la mutation
   * terminée si besoin.
   */
  onClose: () => void;
  /**
   * Désactive la fermeture par overlay/Escape (ex. mutation en cours) — même
   * garde-fou que l'`onClick={busy ? undefined : onClose}` historique des
   * quatre dialogs d'origine. Par défaut `false`.
   */
  closeDisabled?: boolean;
  /** Largeur maximale de la carte en desktop (px). Défaut 440 (valeur historique des quatre dialogs). */
  maxWidth?: number;
  /**
   * Élément vers lequel rendre le focus à la fermeture si l'élément
   * précédemment focusé n'est plus disponible (retiré du DOM, ou
   * `document.body` parce qu'il l'a été AVANT même que ce composant ait pu
   * le capturer — cf. JSDoc de fichier, M1). Optionnel : sans lui, la
   * fermeture ne force simplement aucun focus dans ce cas plutôt que de le
   * perdre sur `document.body`.
   */
  returnFocusRef?: React.RefObject<HTMLElement> | undefined;
  children: React.ReactNode;
}

/**
 * Panneau modal "glass" (overlay flou + carte), avec focus trap au niveau
 * `document`, retour de focus et fermeture au clavier — cf. JSDoc de fichier
 * pour le détail du contrat d'a11y et du comportement responsive. La
 * mécanique elle-même vit dans `useGlassDialogFocusTrap` ; ce composant n'en
 * est qu'un rendu (carte `padding:24`, `<h2>` de titre unique, un seul scroll)
 * — cf. JSDoc de fichier pour les appelants qui ont besoin de la mécanique
 * seule avec un autre rendu.
 */
export function GlassDialogShell({
  title,
  onClose,
  closeDisabled = false,
  maxWidth = 440,
  returnFocusRef,
  children,
}: GlassDialogShellProps) {
  const { titleId, containerRef } = useGlassDialogFocusTrap({
    onClose,
    closeDisabled,
    returnFocusRef,
  });
  const isMobile = useIsMobile();
  const overlayPadding = isMobile ? 16 : 24;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={closeDisabled ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: overlayPadding,
      }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          borderRadius: NX.radius,
          padding: 24,
          maxWidth,
          width: '100%',
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.glassShadow,
          maxHeight: '100%',
          overflowY: 'auto',
          // Le focus visible par défaut du navigateur sur un conteneur
          // `tabIndex={-1}` (fallback "rien de focusable dedans") est inutile
          // ici : la carte n'a pas vocation à porter elle-même une action.
          outline: 'none',
        }}
      >
        <h2 id={titleId} style={{ fontSize: 16, fontWeight: 500, color: NX.fg, margin: 0 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Paragraphe de description standard des dialogs "glass" — dupliqué à
 * l'identique dans les quatre dialogs d'origine avant MAN-201.
 */
export function GlassDialogDescription({
  style,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5, ...style }}
      {...props}
    />
  );
}

/**
 * Rangée de CTA standard des dialogs "glass" — `flex-end` alignée à droite
 * en desktop (rendu historique inchangé), empilée en colonne inversée sous
 * le breakpoint mobile (CTA principal, dernier enfant, visuellement en haut
 * — le pattern standard des feuilles d'action mobiles) plutôt que de rester
 * sur une ligne : c'est la ligne `display:flex; justify-content:flex-end`
 * SANS `flex-wrap` des quatre originaux qui débordait horizontalement à
 * 320px dès qu'un CTA grossissait pour la cible tactile 44px (cf. JSDoc de
 * fichier). `flexWrap: 'wrap'` reste posé même en desktop par défense —
 * aucune rangée desktop actuelle n'en a besoin, mais un futur contenu plus
 * long ne débordera pas silencieusement.
 */
export function GlassDialogActions({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 20,
        flexWrap: 'wrap',
        flexDirection: isMobile ? 'column-reverse' : 'row',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Taille de CTA (`Button`) à utiliser dans un `GlassDialogShell` : `sm` en
 * desktop (rendu historique, inchangé), `lg` (44px de haut) sous le
 * breakpoint mobile — la cible tactile 44px du WCAG 2.5.5 n'est pas atteinte
 * par `sm` (32px). Même idiome que `ResponsiveAppShell` (`router.tsx`) pour
 * détecter le mobile.
 */
export function useDialogCtaSize(): ButtonSize {
  return useIsMobile() ? 'lg' : 'sm';
}

/**
 * Bump commun de cible tactile 44px pour les deux familles de bouton "raw
 * `<button>`" du shell (`GlassDialogSecondaryButton`/`GlassDialogPrimaryButton`)
 * — UNE seule définition pour que le prochain changement de valeur n'ait
 * plus qu'un seul endroit à toucher (avant la revue MAN-201/M3, ce pair
 * padding/minHeight était dupliqué une troisième fois, inline, dans
 * `ConfirmGroupActionDialog`).
 */
function dialogRawButtonTouchTargetStyle(isMobile: boolean): React.CSSProperties {
  return isMobile ? { padding: '13px 18px', minHeight: 44 } : { padding: '8px 18px' };
}

export interface GlassDialogSecondaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Grise le bouton SANS jamais poser l'attribut HTML natif `disabled` — le
   * navigateur ne peut donc jamais lui retirer le focus au moment où cette
   * prop bascule à `true` (cf. GlassDialogShell.tsx JSDoc, MAN-201 review
   * C1 : un `disabled` natif sur l'élément focusé le fait "blur" vers
   * `document.body`, hors de portée du focus trap document-level). Le
   * `onClick` fourni est court-circuité en interne quand `disabled` est
   * vrai — cf. Button.tsx pour le composant `softDisabled` équivalent, en
   * cours de revue sur une autre branche (MAN-208) au moment d'écrire ceci ;
   * une fois mergé, on pourra reconsidérer si ce composant doit plutôt
   * déléguer à `Button`, mais ce garde-fou local reste correct en attendant.
   */
  disabled?: boolean;
  /**
   * Distingue "grisé parce qu'une mutation tourne" de "grisé pour une autre
   * raison" — `disabled` seul ne le dit pas, et un curseur "wait" sur un
   * bouton disabled pour une raison non transitoire serait trompeur. Défaut
   * : reflète `disabled` (comportement historique, où la seule raison de
   * désactivation était toujours une mutation en cours).
   */
  busy?: boolean;
}

/**
 * Style du bouton secondaire "Annuler"/"Retour"/"Fermer" des dialogs
 * "glass" — dupliqué à l'identique dans les quatre dialogs d'origine avant
 * MAN-201. Composant plutôt que simple objet de style exporté : la cible
 * tactile 44px sous le breakpoint mobile nécessite `useIsMobile`, un hook ne
 * peut pas être appelé dans un objet statique.
 */
export const GlassDialogSecondaryButton = React.forwardRef<
  HTMLButtonElement,
  GlassDialogSecondaryButtonProps
>(function GlassDialogSecondaryButton({ style, disabled, busy, onClick, ...props }, ref) {
  const isMobile = useIsMobile();
  const isBusy = busy ?? disabled ?? false;
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
      }}
      style={{
        ...dialogRawButtonTouchTargetStyle(isMobile),
        borderRadius: NX.radiusPill,
        background: 'transparent',
        color: NX.fgMuted,
        border: `1px solid ${NX.border}`,
        fontSize: 13,
        fontWeight: 500,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? (isBusy ? 'wait' : 'not-allowed') : 'pointer',
        ...style,
      }}
      {...props}
    />
  );
});

export interface GlassDialogPrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Cf. `GlassDialogSecondaryButtonProps.disabled`. */
  disabled?: boolean;
  /** Cf. `GlassDialogSecondaryButtonProps.busy`. */
  busy?: boolean;
}

/**
 * CTA principal à remplissage plein des dialogs "glass" — pour l'action la
 * plus destructrice de l'app (`ConfirmGroupActionDialog`), le variant
 * `destructive` du composant `Button` partagé (contour à faible opacité) ne
 * suffit pas visuellement : ce composant porte le même remplissage `NX.error`
 * plein qu'avant MAN-201, mais mutualise désormais le bump de cible tactile
 * 44px (`dialogRawButtonTouchTargetStyle`) au lieu de le dupliquer inline, et
 * grise via `aria-disabled` (jamais `disabled` natif) comme
 * `GlassDialogSecondaryButton` — mêmes raisons, cf. sa JSDoc. Ne porte qu'un
 * ton "erreur" pour l'instant (`style` permet d'overrider `color`/poids pour
 * un appelant qui a besoin d'un autre ton, ex. `ConfirmDisconnectModal` —
 * MAN-241) — à généraliser (prop de ton) le jour où un troisième appelant en
 * a besoin.
 */
export const GlassDialogPrimaryButton = React.forwardRef<
  HTMLButtonElement,
  GlassDialogPrimaryButtonProps
>(function GlassDialogPrimaryButton({ style, disabled, busy, onClick, ...props }, ref) {
  const isMobile = useIsMobile();
  const isBusy = busy ?? disabled ?? false;
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
      }}
      style={{
        ...dialogRawButtonTouchTargetStyle(isMobile),
        borderRadius: NX.radiusPill,
        background: NX.error,
        color: '#1a0606',
        border: 'none',
        fontSize: 13,
        fontWeight: 500,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? (isBusy ? 'wait' : 'not-allowed') : 'pointer',
        ...style,
      }}
      {...props}
    />
  );
});
