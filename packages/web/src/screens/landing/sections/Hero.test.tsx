import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Hero } from './Hero';

/**
 * MAN-242 — « à un seul groupe » suggérait que les sessions messagerie
 * sont scopées à un groupe Nexus précis, contredisant ADR-028 (sessions
 * scopées USER : un compte connecté vaut pour tous les groupes). Le badge
 * de plateformes annonçait aussi IOS/ANDROID, inexistants — repéré en
 * rendant la page, en plus des 4 réponses FAQ listées par le ticket.
 */
describe('Hero — exactitude de la promesse (MAN-242)', () => {
  it('ne suggère plus que les messageries sont branchées à un seul groupe', () => {
    render(<Hero onDownload={vi.fn()} onDemo={vi.fn()} />);

    expect(screen.queryByText(/à un seul groupe/i)).not.toBeInTheDocument();
    expect(screen.getByText(/au même endroit/i)).toBeInTheDocument();
  });

  it("n'annonce plus d'apps iOS/Android natives dans le badge de plateformes", () => {
    render(<Hero onDownload={vi.fn()} onDemo={vi.fn()} />);

    expect(screen.queryByText(/IOS · ANDROID/i)).not.toBeInTheDocument();
    expect(screen.getByText(/MACOS · WINDOWS · LINUX · WEB/i)).toBeInTheDocument();
  });
});
