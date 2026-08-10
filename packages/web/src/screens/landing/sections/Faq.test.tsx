import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Faq } from './Faq';

/**
 * MAN-242 — la FAQ affirmait des capacités inexistantes (chiffrement de
 * bout en bout, auto-post en conversation, apps iOS/Android natives,
 * relances automatiques de dépenses). Un test par affirmation corrigée,
 * pour que ces regressions de copie ne reviennent pas silencieusement.
 */
describe('Faq — exactitude des réponses (MAN-242)', () => {
  it("n'affirme plus de chiffrement de bout en bout ni de conservation zéro", () => {
    render(<Faq />);

    expect(screen.queryByText(/chiffré de bout en bout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rien n'est conservé/i)).not.toBeInTheDocument();
    expect(screen.getByText(/on n'y a techniquement pas accès/i)).toBeInTheDocument();
  });

  it("n'affirme plus que les events/sondages arrivent directement dans la conversation, et précise qu'un compte est requis pour participer", () => {
    render(<Faq />);

    expect(
      screen.queryByText(/arrivent directement dans leur conversation/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/n'est indispensable qu'à celui qui organise/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/tu leur partages un lien/i)).toBeInTheDocument();
    expect(screen.getByText(/une invitation au groupe suffisent/i)).toBeInTheDocument();
  });

  it("n'annonce plus d'apps iOS/Android natives inexistantes", () => {
    render(<Faq />);

    expect(screen.queryByText(/iOS et Android/i)).not.toBeInTheDocument();
    expect(screen.getByText(/macOS, Windows et Linux/i)).toBeInTheDocument();
  });

  it("n'affirme plus de relance automatique des dépenses", () => {
    render(<Faq />);

    expect(screen.queryByText(/relance automatiquement/i)).not.toBeInTheDocument();
    expect(screen.getByText(/vous rembourser directement/i)).toBeInTheDocument();
  });
});
