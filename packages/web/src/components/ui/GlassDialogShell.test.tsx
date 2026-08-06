/**
 * GlassDialogShell — tests (MAN-201, incluant les correctifs de la revue
 * C1/M1/M2/M3/M4).
 *
 * Le stub par défaut de `window.matchMedia` (branche desktop, `matches:
 * false`) vit dans `test/setup.ts` — voir sa JSDoc pour le pourquoi. Les
 * quelques tests ci-dessous qui exercent explicitement le comportement
 * MOBILE de `useDialogCtaSize`/`GlassDialogActions`/`GlassDialog*Button`
 * réaffectent `window.matchMedia` localement via `mockMobileMatchMedia()`,
 * qui gagne sur le stub global (réaffectation postérieure dans l'ordre des
 * hooks/du corps de test) sans que les autres tests du fichier n'aient à
 * s'en soucier.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  GlassDialogActions,
  GlassDialogDescription,
  GlassDialogPrimaryButton,
  GlassDialogSecondaryButton,
  GlassDialogShell,
  useDialogCtaSize,
} from './GlassDialogShell';

/** Réaffecte `window.matchMedia` pour ce test précis sur la branche mobile (`matches: true`). */
function mockMobileMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  }));
}

describe('GlassDialogShell', () => {
  describe('contrat a11y', () => {
    it('expose role="dialog", aria-modal="true", et un nom accessible dérivé du titre', () => {
      render(
        <GlassDialogShell title="Confirmer l'action" onClose={vi.fn()}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      const dialog = screen.getByRole('dialog', { name: "Confirmer l'action" });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      // Le titre est bien un heading (h2), pas seulement un texte visuel
      // planqué derrière aria-labelledby.
      expect(screen.getByRole('heading', { name: "Confirmer l'action" })).toBeInTheDocument();
    });

    it('Escape ferme le dialog et appelle onClose', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape n’appelle pas onClose quand closeDisabled est vrai (ex. mutation en cours)', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose} closeDisabled>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('le clic sur l’overlay ferme le dialog, sauf quand closeDisabled est vrai', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <GlassDialogShell title="T" onClose={onClose} closeDisabled>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.click(screen.getByRole('dialog'));
      expect(onClose).not.toHaveBeenCalled();

      rerender(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );
      await user.click(screen.getByRole('dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('le clic à l’intérieur de la carte ne ferme pas le dialog (stopPropagation)', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      await user.click(screen.getByRole('button', { name: 'OK' }));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('déplace le focus dans le dialog à l’ouverture, et boucle Tab/Shift+Tab aux bornes sans jamais fuir vers le contenu externe', async () => {
      // Preuve que l'assertion n'est pas vacueuse : "Avant"/"Après" entourent
      // le dialog dans l'ordre naturel du DOM. Sans le trap, `Tab` depuis
      // "Dernier" irait à "Après" et `Shift+Tab` depuis "Premier" irait à
      // "Avant" — le test échouerait.
      const user = userEvent.setup();
      render(
        <>
          <button type="button">Avant</button>
          <GlassDialogShell title="T" onClose={vi.fn()}>
            <button type="button">Premier</button>
            <button type="button">Dernier</button>
          </GlassDialogShell>
          <button type="button">Après</button>
        </>,
      );

      const first = screen.getByRole('button', { name: 'Premier' });
      const last = screen.getByRole('button', { name: 'Dernier' });

      expect(first).toHaveFocus();

      await user.tab();
      expect(last).toHaveFocus();

      await user.tab();
      expect(first).toHaveFocus();

      await user.tab({ shift: true });
      expect(last).toHaveFocus();

      await user.tab({ shift: true });
      expect(first).toHaveFocus();
    });

    it('rend le focus à l’élément déclencheur après la fermeture du dialog', async () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Ouvrir
            </button>
            {open ? (
              <GlassDialogShell title="T" onClose={() => setOpen(false)}>
                <button type="button">OK</button>
              </GlassDialogShell>
            ) : null}
          </>
        );
      }

      const user = userEvent.setup();
      render(<Harness />);

      const trigger = screen.getByRole('button', { name: 'Ouvrir' });
      await user.click(trigger);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('sans élément focusable dans la carte, le focus tombe sur la carte elle-même, et Tab n’en sort pas', () => {
      // Déplacé hors de `describe('responsive')` (revue MAN-201, M4) : ce
      // test couvre le contrat a11y (repli de focus), pas le responsive — et
      // n'exerçait pas Tab, laissant la branche `!first || !last` du handler
      // sans couverture réelle.
      render(
        <GlassDialogShell title="Chargement…" onClose={vi.fn()}>
          <p>Patiente…</p>
        </GlassDialogShell>,
      );

      const card = screen.getByRole('dialog').firstElementChild as HTMLElement;
      expect(document.activeElement).toBe(card);

      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(card);
    });
  });

  // MAN-201 review C1 : le focus trap doit fonctionner même quand
  // `document.activeElement` est `<body>` — ce qui arrive dès qu'un CTA
  // `disabled` natif perd le focus au profit du navigateur pendant une
  // mutation (cf. GlassDialogShell.tsx JSDoc). Un `onKeyDown` React sur
  // l'overlay ne recevrait JAMAIS ces événements (`body` n'est pas un
  // descendant de l'overlay) : ces tests dispatchent directement sur
  // `document`/`document.body`, PAS via `user.keyboard()`/`user.tab()` (qui
  // opèrent sur `document.activeElement`, ici DANS le dialog par défaut) —
  // pour prouver que le listener `document`-level fonctionne réellement
  // indépendamment de la cible.
  describe('focus trap document-level (revue C1)', () => {
    it('Tab dont la cible est document.body ramène le focus dans la carte, jamais vers le contenu externe', () => {
      render(
        <>
          <button type="button">Avant</button>
          <GlassDialogShell title="T" onClose={vi.fn()}>
            <button type="button">Premier</button>
            <button type="button">Dernier</button>
          </GlassDialogShell>
          <button type="button">Après</button>
        </>,
      );

      const first = screen.getByRole('button', { name: 'Premier' });
      // Simule un CTA qui vient de perdre le focus vers `body` (ex. un
      // `disabled` natif appliqué pendant une mutation).
      first.blur();
      expect(document.activeElement).toBe(document.body);

      fireEvent.keyDown(document.body, { key: 'Tab', bubbles: true, cancelable: true });

      // Sans le correctif C1, cet événement n'atteindrait aucun handler et
      // le Tab natif du navigateur (non simulé ici, mais c'est le point)
      // partirait dans "Après". Le listener `document`-level, lui, boucle
      // toujours vers le premier focusable de la carte.
      expect(first).toHaveFocus();
    });

    it('Shift+Tab dont la cible est document.body boucle vers le dernier élément de la carte', () => {
      render(
        <>
          <button type="button">Avant</button>
          <GlassDialogShell title="T" onClose={vi.fn()}>
            <button type="button">Premier</button>
            <button type="button">Dernier</button>
          </GlassDialogShell>
          <button type="button">Après</button>
        </>,
      );

      const last = screen.getByRole('button', { name: 'Dernier' });
      screen.getByRole('button', { name: 'Premier' }).blur();
      expect(document.activeElement).toBe(document.body);

      fireEvent.keyDown(document.body, {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      expect(last).toHaveFocus();
    });

    it('Escape dont la cible est document.body ferme quand même le dialog', () => {
      const onClose = vi.fn();
      render(
        <GlassDialogShell title="T" onClose={onClose}>
          <button type="button">OK</button>
        </GlassDialogShell>,
      );

      screen.getByRole('button', { name: 'OK' }).blur();
      expect(document.activeElement).toBe(document.body);

      fireEvent.keyDown(document.body, { key: 'Escape', bubbles: true, cancelable: true });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('un focus programmatique externe (hors Tab) est immédiatement ramené dans la carte (garde-fou focusin)', () => {
      render(
        <>
          <button type="button" data-testid="external">
            Externe
          </button>
          <GlassDialogShell title="T" onClose={vi.fn()}>
            <button type="button">Premier</button>
          </GlassDialogShell>
        </>,
      );

      const first = screen.getByRole('button', { name: 'Premier' });
      expect(first).toHaveFocus();

      // Pas un Tab : un appel `.focus()` direct, scénario que le `keydown`
      // seul ne couvre pas (cf. GlassDialogShell.tsx JSDoc).
      screen.getByTestId('external').focus();

      expect(first).toHaveFocus();
    });

    it('deux instances montées simultanément : Escape ne ferme que celle du dessus (pile document-level)', () => {
      const onCloseA = vi.fn();
      const onCloseB = vi.fn();

      render(
        <GlassDialogShell title="A" onClose={onCloseA}>
          <button type="button">A action</button>
        </GlassDialogShell>,
      );
      // Deuxième `render()` sans `unmount()` du premier : les deux overlays
      // coexistent, comme le feraient deux instances réellement empilées.
      render(
        <GlassDialogShell title="B" onClose={onCloseB}>
          <button type="button">B action</button>
        </GlassDialogShell>,
      );

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onCloseB).toHaveBeenCalledTimes(1);
      expect(onCloseA).not.toHaveBeenCalled();
    });
  });

  // MAN-201 review M1 : `document.activeElement` n'est jamais `null` —
  // rejeter `document.body` comme "focus précédent" valide, et retomber sur
  // `returnFocusRef` quand ni l'un ni l'autre ne convient.
  describe('retour de focus à la fermeture (revue M1)', () => {
    it('rejette document.body comme cible de restauration et utilise returnFocusRef en repli', async () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const fallbackRef = useRef<HTMLButtonElement>(null);
        const triggerRef = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button ref={fallbackRef} type="button">
              Repli
            </button>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => {
                // Simule le déclencheur qui a DÉJÀ perdu le focus au moment
                // où `GlassDialogShell` se monte (ex. un `disabled` natif
                // posé au clic, avant même que React ne commit le dialog).
                triggerRef.current?.blur();
                setOpen(true);
              }}
            >
              Ouvrir
            </button>
            {open ? (
              <GlassDialogShell
                title="T"
                onClose={() => setOpen(false)}
                returnFocusRef={fallbackRef}
              >
                <button type="button">OK</button>
              </GlassDialogShell>
            ) : null}
          </>
        );
      }

      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Sans le rejet de `document.body` (M1), `previouslyFocused` vaudrait
      // `document.body` et `.focus()` dessus ne ferait rien : "Repli" ne
      // recevrait jamais le focus.
      expect(screen.getByRole('button', { name: 'Repli' })).toHaveFocus();
    });

    it('replie sur returnFocusRef si l’élément précédemment focusé a été retiré du DOM pendant que le dialog était ouvert', async () => {
      // Reproduit `ConfirmGroupActionDialog`/`RemoveMemberDialog` après
      // succès : le déclencheur disparaît DANS LE MÊME commit que la
      // fermeture du dialog (deux `setState` batchés dans le même handler).
      function Harness() {
        const [showTrigger, setShowTrigger] = useState(true);
        const [open, setOpen] = useState(false);
        const fallbackRef = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button ref={fallbackRef} type="button">
              Repli
            </button>
            {showTrigger ? (
              <button type="button" onClick={() => setOpen(true)}>
                Ouvrir
              </button>
            ) : null}
            {open ? (
              <GlassDialogShell
                title="T"
                onClose={() => setOpen(false)}
                returnFocusRef={fallbackRef}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowTrigger(false);
                    setOpen(false);
                  }}
                >
                  Confirmer
                </button>
              </GlassDialogShell>
            ) : null}
          </>
        );
      }

      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
      await user.click(screen.getByRole('button', { name: 'Confirmer' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ouvrir' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Repli' })).toHaveFocus();
    });
  });

  // MAN-201 review M2 : le sélecteur CSS de `getFocusableElements` ne
  // garantit pas qu'un élément peut RÉELLEMENT prendre le focus.
  describe('robustesse de la détection de focusabilité (revue M2)', () => {
    it('exclut un input[type="hidden"] de la cible de focus initiale', () => {
      render(
        <GlassDialogShell title="T" onClose={vi.fn()}>
          <input type="hidden" value="x" readOnly />
          <button type="button">Réel</button>
        </GlassDialogShell>,
      );

      expect(screen.getByRole('button', { name: 'Réel' })).toHaveFocus();
    });

    it('exclut un descendant de <fieldset disabled> — vérifiable en jsdom, qui refuse réellement .focus() dessus', () => {
      render(
        <GlassDialogShell title="T" onClose={vi.fn()}>
          <button type="button">Premier</button>
          <fieldset disabled>
            <button type="button">Dans fieldset désactivé</button>
          </fieldset>
        </GlassDialogShell>,
      );

      // Le focus initial ne doit jamais viser le bouton du fieldset
      // désactivé : seul "Premier" est un candidat réel.
      const first = screen.getByRole('button', { name: 'Premier' });
      expect(first).toHaveFocus();

      // Un seul candidat réel dans la carte : Tab boucle sur lui-même plutôt
      // que de tenter (et échouer silencieusement sur) le bouton désactivé.
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(first).toHaveFocus();
    });

    it('replie sur la carte si le focus initial visé ne prend pas réellement (élément qui matche le sélecteur sans être focusable)', () => {
      render(
        <GlassDialogShell title="T" onClose={vi.fn()}>
          <button
            type="button"
            ref={(el) => {
              // Patché AVANT que l'effet de montage de `GlassDialogShell`
              // (passive effect, postérieur à l'attachement du ref) n'appelle
              // `.focus()` dessus — simule un cas de non-focusabilité réelle
              // qu'`isRenderedFocusable` n'a pas anticipé statiquement.
              // `Object.defineProperty` plutôt qu'une assignation directe :
              // `HTMLElement.prototype.focus` n'a pas de setter en jsdom,
              // une assignation directe jette `TypeError`.
              if (el)
                Object.defineProperty(el, 'focus', { value: () => undefined, configurable: true });
            }}
          >
            Premier
          </button>
        </GlassDialogShell>,
      );

      const card = screen.getByRole('dialog').firstElementChild as HTMLElement;
      expect(document.activeElement).toBe(card);
    });

    it('replie sur la carte si le focus visé par un bouclage Tab/Shift+Tab ne prend pas réellement', () => {
      render(
        <GlassDialogShell title="T" onClose={vi.fn()}>
          <button type="button">Premier</button>
          <button
            type="button"
            ref={(el) => {
              if (el)
                Object.defineProperty(el, 'focus', { value: () => undefined, configurable: true });
            }}
          >
            Dernier
          </button>
        </GlassDialogShell>,
      );

      const first = screen.getByRole('button', { name: 'Premier' });
      expect(first).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

      const card = screen.getByRole('dialog').firstElementChild as HTMLElement;
      expect(document.activeElement).toBe(card);
    });
  });
});

describe('useDialogCtaSize', () => {
  function Probe() {
    const size = useDialogCtaSize();
    return <span data-testid="size">{size}</span>;
  }

  it('retourne "sm" en desktop (comportement historique inchangé, stub global de test/setup.ts)', () => {
    render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('sm');
  });

  it('retourne "lg" (44px) sous le breakpoint mobile', () => {
    mockMobileMatchMedia();
    render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('lg');
  });
});

describe('GlassDialogActions (revue M3)', () => {
  it('aligne à droite en ligne (desktop), sans jamais empêcher le retour à la ligne', () => {
    render(
      <GlassDialogActions>
        <button type="button">Annuler</button>
        <button type="button">Confirmer</button>
      </GlassDialogActions>,
    );

    expect(screen.getByRole('button', { name: 'Annuler' }).parentElement).toHaveStyle({
      flexDirection: 'row',
      flexWrap: 'wrap',
    });
  });

  it('empile en colonne inversée sous le breakpoint mobile (CTA principal visuellement en haut)', () => {
    mockMobileMatchMedia();
    render(
      <GlassDialogActions>
        <button type="button">Annuler</button>
        <button type="button">Confirmer</button>
      </GlassDialogActions>,
    );

    expect(screen.getByRole('button', { name: 'Annuler' }).parentElement).toHaveStyle({
      flexDirection: 'column-reverse',
    });
  });
});

// Valeur littérale du token plutôt qu'un import de `NX` : évite un couplage
// superflu de ce fichier de test à `lib/tokens`, la valeur `var(--nx-fg-muted)`
// EST le contrat public de `GlassDialogDescription`.
const NX_FG_MUTED = 'var(--nx-fg-muted)';

describe('GlassDialogDescription', () => {
  it('applique le style de paragraphe de description partagé', () => {
    render(<GlassDialogDescription>Un texte</GlassDialogDescription>);
    const p = screen.getByText('Un texte');
    expect(p.tagName).toBe('P');
    expect(p.style.color).toBe(NX_FG_MUTED);
  });
});

describe('GlassDialogSecondaryButton', () => {
  it('garde le padding compact historique en desktop (stub global de test/setup.ts)', () => {
    render(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button.style.minHeight).toBe('');
  });

  it('atteint la cible tactile 44px sous le breakpoint mobile', () => {
    mockMobileMatchMedia();
    render(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button.style.minHeight).toBe('44px');
  });

  it('grise via aria-disabled, jamais un disabled natif (revue MAN-201, C1)', () => {
    render(<GlassDialogSecondaryButton disabled>Annuler</GlassDialogSecondaryButton>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
  });

  it('court-circuite le onClick fourni quand disabled est vrai', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <GlassDialogSecondaryButton disabled onClick={onClick}>
        Annuler
      </GlassDialogSecondaryButton>,
    );

    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('curseur "wait" quand busy, "not-allowed" quand disabled pour une autre raison, "pointer" sinon', () => {
    const { rerender } = render(
      <GlassDialogSecondaryButton disabled busy>
        Annuler
      </GlassDialogSecondaryButton>,
    );
    expect(screen.getByRole('button', { name: 'Annuler' }).style.cursor).toBe('wait');

    rerender(
      <GlassDialogSecondaryButton disabled busy={false}>
        Annuler
      </GlassDialogSecondaryButton>,
    );
    expect(screen.getByRole('button', { name: 'Annuler' }).style.cursor).toBe('not-allowed');

    rerender(<GlassDialogSecondaryButton>Annuler</GlassDialogSecondaryButton>);
    expect(screen.getByRole('button', { name: 'Annuler' }).style.cursor).toBe('pointer');
  });
});

describe('GlassDialogPrimaryButton', () => {
  it('grise via aria-disabled, jamais un disabled natif, et court-circuite le clic (revue MAN-201, C1)', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <GlassDialogPrimaryButton disabled onClick={onClick}>
        Supprimer
      </GlassDialogPrimaryButton>,
    );

    const button = screen.getByRole('button', { name: 'Supprimer' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('atteint la cible tactile 44px sous le breakpoint mobile', () => {
    mockMobileMatchMedia();
    render(<GlassDialogPrimaryButton>Supprimer</GlassDialogPrimaryButton>);
    expect(screen.getByRole('button', { name: 'Supprimer' }).style.minHeight).toBe('44px');
  });
});
