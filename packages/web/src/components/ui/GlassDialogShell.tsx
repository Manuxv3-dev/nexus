/**
 * GlassDialogShell — panneau modal "glass" partagé (MAN-201).
 *
 * Extrait de la copie quasi-identique répétée dans `TransferOwnershipDialog`,
 * `RemoveMemberDialog`, `LeaveGroupDialog` (`screens/app/GroupMembersPanel.tsx`)
 * et `ConfirmGroupActionDialog` (`screens/app/GroupMenu.tsx`) : overlay flou +
 * carte "glass" (`NX.glassBg`/`glassBlur`/`glassBorder`/`glassShadow`). Ce
 * composant ne porte AUCUNE logique métier — chaque appelant garde ses
 * propres mutations/actions, seul le chrome visuel + l'accessibilité sont
 * mutualisés.
 *
 * Contrat d'accessibilité :
 *  - `role="dialog"` + `aria-modal="true"` sur l'overlay ;
 *  - `aria-labelledby` pointe vers le titre (`title`), rendu en `<h2>` par ce
 *    composant lui-même (id généré via `useId`) — les appelants n'ont plus à
 *    gérer eux-mêmes l'id ni le `<h2>` ;
 *  - **focus trap** : au montage, le focus est déplacé sur le premier élément
 *    focusable de la carte (ou la carte elle-même, `tabIndex={-1}`, si aucun
 *    élément focusable n'est présent — ex. écran de chargement transitoire).
 *    `Tab`/`Shift+Tab` bouclent à l'intérieur de la carte : ils ne peuvent
 *    jamais faire sortir le focus vers le contenu applicatif sous l'overlay
 *    (toujours monté, pas d'`inert`/`aria-hidden` posé dessus). La liste des
 *    éléments focusables est recalculée à CHAQUE `Tab` plutôt que mise en
 *    cache au montage : le contenu de la carte change parfois entre deux
 *    étapes d'un même dialog (ex. `TransferOwnershipDialog` : choix → étape
 *    de confirmation), une liste figée boucleral sur des éléments qui ne
 *    sont plus rendus ;
 *  - à la fermeture (démontage), le focus revient sur l'élément qui l'avait
 *    avant l'ouverture (typiquement le bouton déclencheur) ;
 *  - **Escape** ferme le dialog, sauf si `closeDisabled` (ex. mutation en
 *    cours — même garde-fou que le clic sur l'overlay, qui ne ferme pas non
 *    plus dans ce cas). Les CTA internes (Annuler/Confirmer) gèrent leur
 *    propre `disabled` indépendamment de cette prop.
 *
 * Comportement responsive (MAN-201) :
 *  - pas de `maxWidth` fixe qui dépasserait le viewport : la carte reste
 *    `width: 100%` de l'espace disponible (overlay `padding` inclus dans le
 *    calcul via `box-sizing: border-box`, cf. `styles/global.css`), plafonnée
 *    à `maxWidth` (440px par défaut, identique à l'existant) uniquement
 *    au-delà ;
 *  - `max-height` + `overflow-y: auto` sur la carte : un contenu plus grand
 *    que l'écran (ex. le `<select>` de `TransferOwnershipDialog` sur un
 *    petit viewport) scrolle À L'INTÉRIEUR de la carte plutôt que de déborder
 *    de l'écran ;
 *  - l'overlay réduit son `padding` sous le breakpoint mobile (`useIsMobile`,
 *    même idiome que `ResponsiveAppShell` dans `router.tsx`) pour maximiser
 *    la largeur disponible sur un viewport étroit (vérifié à 320px).
 */
import * as React from 'react';

import { NX } from '@/lib/tokens';
import { useIsMobile } from '@/lib/useMedia';

import type { ButtonSize } from './Button';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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
  children: React.ReactNode;
}

/**
 * Panneau modal "glass" (overlay flou + carte), avec focus trap, retour de
 * focus et fermeture au clavier — cf. JSDoc de fichier pour le détail du
 * contrat d'a11y et du comportement responsive.
 */
export function GlassDialogShell({
  title,
  onClose,
  closeDisabled = false,
  maxWidth = 440,
  children,
}: GlassDialogShellProps) {
  const titleId = React.useId();
  const cardRef = React.useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = cardRef.current;
    if (container) {
      const focusables = getFocusableElements(container);
      (focusables[0] ?? container).focus();
    }

    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Une seule fois au montage/démontage : le dialog entier est monté puis
    // démonté par l'appelant (jamais réutilisé "open"/"closed" en place), pas
    // besoin de ré-exécuter cet effet entre deux renders.
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (!closeDisabled) onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const container = cardRef.current;
    if (!container) return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) {
      // Rien de focusable dans la carte : garde le focus sur la carte
      // elle-même plutôt que de laisser Tab s'échapper vers le contenu
      // applicatif sous l'overlay.
      e.preventDefault();
      container.focus();
      return;
    }

    // `noUncheckedIndexedAccess` type tout accès par index `T | undefined`,
    // y compris ici où `focusables.length === 0` a déjà fait `return`
    // au-dessus (`tsc` ne relie pas ce garde-fou à l'accès par index qui
    // suit). `@typescript-eslint/non-nullable-type-assertion-style` impose
    // `!` plutôt qu'un cast `as` pour ce genre de retrait d'undefined —
    // désactivé ponctuellement pour l'autre règle qui le découragerait sinon.
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  const overlayPadding = isMobile ? 16 : 24;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={closeDisabled ? undefined : onClose}
      onKeyDown={handleKeyDown}
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
        ref={cardRef}
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
          maxHeight: `calc(100vh - ${overlayPadding * 2}px)`,
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
 * Style du bouton secondaire "Annuler"/"Retour"/"Fermer" des dialogs
 * "glass" — dupliqué à l'identique (à la gestion du curseur près, unifiée
 * ici sur `disabled`) dans les quatre dialogs d'origine avant MAN-201.
 * Composant plutôt que simple objet de style exporté : la cible tactile
 * 44px sous le breakpoint mobile nécessite `useIsMobile`, un hook ne peut
 * pas être appelé dans un objet statique.
 */
export const GlassDialogSecondaryButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function GlassDialogSecondaryButton({ style, disabled, ...props }, ref) {
  const isMobile = useIsMobile();
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      style={{
        padding: isMobile ? '13px 18px' : '8px 18px',
        minHeight: isMobile ? 44 : undefined,
        borderRadius: NX.radiusPill,
        background: 'transparent',
        color: NX.fgMuted,
        border: `1px solid ${NX.border}`,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer',
        ...style,
      }}
      {...props}
    />
  );
});
