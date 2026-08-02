import type { ReactNode } from 'react';

import { NX } from '@/lib/tokens';

/**
 * Override de classes pour les liens texte des écrans auth ("Créer un compte",
 * "Mot de passe oublié", "Retour à la connexion").
 *
 * Ces liens passent par le `Button` partagé (MAN-110) pour hériter de son
 * contrat d'interaction — `type="button"` par défaut, anneau de focus
 * `focus-visible:shadow-focus`, `active:scale` — mais pas de sa boîte : on
 * neutralise hauteur, padding et relief de survol pour retrouver l'aspect d'un
 * lien inline. La typographie (taille/graisse) reste au call site : elle diffère
 * d'un écran à l'autre.
 *
 * Volontairement une constante partagée plutôt qu'un variant `link` dans
 * `Button.tsx` : `Button.test.tsx` verrouille l'invariant « tout variant expose
 * un `hover:shadow-*` » (MAN-110 Task 2), qu'un variant lien contredirait par
 * construction. Déclarer ce variant est une décision du design system, pas de
 * cette tranche d'habillage.
 */
export const AUTH_LINK_BUTTON_CLASS =
  'h-auto p-0 text-nx-primary-text hover:bg-transparent hover:shadow-none';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        background: NX.bg,
      }}
    >
      {/* Halo violet de fond */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,92,252,0.08) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      {/*
        Carte de formulaire : profondeur via les tokens glass/shadow (ADR-021)
        et animation d'entrée.

        L'animation est portée par la carte et pas par le wrapper racine : ce
        dernier fait 100vh et peint `--nx-bg`, qui diffère de `--background` du
        body en light (#E8E8E8 vs #FFFFFF). L'animer ferait virer toute la page
        du blanc au gris pendant la transition, et son `translateY` initial
        déborderait le document de 16px (scrollbar fugace).

        `animate-in` (tailwindcss-animate) ne pose pas de `pointer-events:none` :
        le formulaire reste cliquable/saisissable pendant la transition.
        `prefers-reduced-motion` est neutralisé globalement
        (`styles/global.css:92`), aucune plomberie JS ici.
      */}
      <div
        data-testid="auth-card"
        className="animate-in fade-in slide-in-from-bottom-4 duration-500"
        style={{
          width: '100%',
          maxWidth: 400,
          position: 'relative',
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.shadowMd,
          borderRadius: NX.radiusXl,
          padding: '32px 28px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
