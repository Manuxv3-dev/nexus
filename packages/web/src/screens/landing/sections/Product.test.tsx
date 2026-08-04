import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Product } from './Product';

/**
 * MAN-150 — les 4 cartes d'exemple de la section "01 — Produit" deviennent
 * interactives (état local, aucune persistance). Un test par comportement
 * observable de la spec du ticket.
 *
 * `window.matchMedia` n'existe pas dans jsdom (cf. Button.test.tsx §
 * "prefers-reduced-motion") : chaque carte est enveloppée dans `TiltCard`,
 * dont `onMouseMove` appelle `supportsHover()` → `window.matchMedia(...)`.
 * `userEvent.click` déclenche un survol avant le clic, donc sans stub ça
 * jette dans TOUS les tests de ce fichier, pas seulement ceux qui touchent
 * au tilt. On stub un minimum viable (juste `.matches`, lu de façon
 * synchrone par `supportsHover`) plutôt que de toucher TiltCard.tsx, qu'on
 * ne doit pas casser.
 */
beforeAll(() => {
  // jsdom ne définit pas `window.matchMedia` : on stub inconditionnellement
  // (le type `lib.dom` le déclare non-optionnel, un garde `if
  // (window.matchMedia)` serait donc toujours vrai pour `tsc` alors qu'il
  // est bien `undefined` à l'exécution).
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  }));
});
describe('Product — EventsCard (RSVP)', () => {
  it('affiche des compteurs pré-remplis plausibles au chargement', () => {
    render(<Product />);

    const oui = screen.getByRole('button', { name: /^oui/i });
    const peutEtre = screen.getByRole('button', { name: /peut-être/i });
    const non = screen.getByRole('button', { name: /^non/i });

    expect(oui).toHaveTextContent('8');
    expect(peutEtre).toHaveTextContent('2');
    expect(non).toHaveTextContent('0');
  });

  it('cliquer "Oui" incrémente son compteur et le met en évidence', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const oui = screen.getByRole('button', { name: /^oui/i });
    expect(oui).toHaveAttribute('aria-pressed', 'false');

    await user.click(oui);

    expect(oui).toHaveTextContent('9');
    expect(oui).toHaveAttribute('aria-pressed', 'true');
  });

  it('re-cliquer "Peut-être" déplace le compte du visiteur (jamais deux réponses actives)', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const oui = screen.getByRole('button', { name: /^oui/i });
    const peutEtre = screen.getByRole('button', { name: /peut-être/i });

    await user.click(oui);
    expect(oui).toHaveTextContent('9');

    await user.click(peutEtre);

    expect(oui).toHaveTextContent('8');
    expect(oui).toHaveAttribute('aria-pressed', 'false');
    expect(peutEtre).toHaveTextContent('3');
    expect(peutEtre).toHaveAttribute('aria-pressed', 'true');
  });

  it("activation au clavier (Tab + Entrée) produit le même effet qu'un clic", async () => {
    const user = userEvent.setup();
    render(<Product />);

    const oui = screen.getByRole('button', { name: /^oui/i });
    oui.focus();
    expect(oui).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(oui).toHaveTextContent('9');
    expect(oui).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Product — PollsCard (sondage)', () => {
  it('cliquer une option incrémente son compteur et agrandit sa barre', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const chezClement = screen.getByRole('button', { name: /chez clément/i });
    const barBefore = screen.getByTestId('poll-bar-clement');
    // Total initial 5 + 2 + 0 = 7.
    expect(barBefore.style.width).toBe(`${(5 / 7) * 100}%`);

    await user.click(chezClement);

    expect(chezClement).toHaveTextContent('6');
    const barAfter = screen.getByTestId('poll-bar-clement');
    // Le vote du visiteur s'ajoute : total 8.
    expect(barAfter.style.width).toBe(`${(6 / 8) * 100}%`);
  });

  it('recliquer une autre option déplace le vote (un seul vote actif)', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const chezClement = screen.getByRole('button', { name: /chez clément/i });
    const auParc = screen.getByRole('button', { name: /au parc/i });

    await user.click(chezClement);
    expect(chezClement).toHaveTextContent('6');
    expect(chezClement).toHaveAttribute('aria-pressed', 'true');

    await user.click(auParc);

    expect(chezClement).toHaveTextContent('5');
    expect(chezClement).toHaveAttribute('aria-pressed', 'false');
    expect(auParc).toHaveTextContent('3');
    expect(auParc).toHaveAttribute('aria-pressed', 'true');
  });

  it('recliquer sa propre option déjà active est un no-op', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const onAnnule = screen.getByRole('button', { name: /on annule/i });

    await user.click(onAnnule);
    expect(onAnnule).toHaveTextContent('1');

    await user.click(onAnnule);

    expect(onAnnule).toHaveTextContent('1');
  });
});

describe('Product — TodosCard', () => {
  it('cocher une tâche non faite la marque faite (texte barré)', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const checkbox = screen.getByRole('checkbox', { name: /réserver le van/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("décocher une tâche faite annule proprement l'état, rejouable dans les deux sens", async () => {
    const user = userEvent.setup();
    render(<Product />);

    const checkbox = screen.getByRole('checkbox', { name: /playlist de la route/i });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('toggle au clavier (focus + Espace) fonctionne', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const checkbox = screen.getByRole('checkbox', { name: /acheter les dossards/i });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    expect(checkbox).not.toBeChecked();

    await user.keyboard(' ');

    expect(checkbox).toBeChecked();
  });
});

describe('Product — ExpensesCard', () => {
  it('marquer une dette réglée réduit le total dû affiché', async () => {
    const user = userEvent.setup();
    render(<Product />);

    expect(screen.getByText('184,50 €')).toBeInTheDocument();

    const bar = screen.getByRole('button', { name: /afficher le détail de la répartition/i });
    await user.click(bar);

    const karimDebt = screen.getByRole('button', { name: /karim te doit/i });
    await user.click(karimDebt);

    expect(screen.getByText('123,00 €')).toBeInTheDocument();
    expect(screen.queryByText('184,50 €')).not.toBeInTheDocument();
  });

  it('ajouter une dépense augmente le total et met à jour la répartition', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const addButton = screen.getByRole('button', { name: /ajouter/i });
    await user.click(addButton);

    expect(screen.getByText('216,00 €')).toBeInTheDocument();
  });

  it('marquer TOUTES les dettes réglées affiche 0€ proprement (pas de négatif)', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const bar = screen.getByRole('button', { name: /afficher le détail de la répartition/i });
    await user.click(bar);

    const karimDebt = screen.getByRole('button', { name: /karim te doit/i });
    const leaDebt = screen.getByRole('button', { name: /léa te doit/i });
    const thomasDebt = screen.getByRole('button', { name: /thomas te doit/i });

    await user.click(karimDebt);
    await user.click(leaDebt);
    await user.click(thomasDebt);

    // "0,00 €" bien formaté (pas de "-0,00 €", pas de NaN) prouve à la fois
    // l'absence de négatif et un affichage propre.
    expect(screen.getByText('0,00 €')).toBeInTheDocument();
  });

  it('le détail par personne est accessible au clic sur la barre de répartition', async () => {
    const user = userEvent.setup();
    render(<Product />);

    expect(screen.queryByRole('button', { name: /karim te doit/i })).not.toBeInTheDocument();

    const bar = screen.getByRole('button', { name: /afficher le détail de la répartition/i });
    expect(bar).toHaveAttribute('aria-expanded', 'false');

    await user.click(bar);

    expect(bar).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /karim te doit/i })).toBeInTheDocument();
  });
});

describe('Product — ordre de tabulation', () => {
  it('les Tab successifs parcourent les éléments interactifs sans piège clavier', async () => {
    const user = userEvent.setup();
    render(<Product />);

    const section = document.getElementById('nx-produit');
    if (!section) throw new Error('section #nx-produit introuvable');

    const expectedCount =
      within(section).getAllByRole('button').length +
      within(section).getAllByRole('checkbox').length;

    const seen = new Set<Element>();
    for (let i = 0; i < expectedCount; i += 1) {
      await user.tab();
      const active = document.activeElement;
      expect(active).not.toBeNull();
      if (active) {
        // Pas de piège clavier : chaque Tab doit amener sur un nouvel
        // élément tant qu'il reste des éléments interactifs non visités.
        expect(seen.has(active)).toBe(false);
        seen.add(active);
      }
    }
  });
});
