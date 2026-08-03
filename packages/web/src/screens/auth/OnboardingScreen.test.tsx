/**
 * OnboardingScreen — accessibilité clavier de l'étape 1 (ChoiceCard), MAN-119.
 *
 * `ChoiceCard` était un `<div onClick>` sans rôle ni gestion clavier : un
 * utilisateur au clavier ne pouvait pas terminer son inscription. Pattern
 * `radiogroup` : `role="radiogroup"` sur le conteneur, `role="radio"` +
 * `aria-checked` + roving tabindex sur chaque carte, navigation flèches,
 * `<Input>` sorti du radio (imbriquer du contenu interactif dans un
 * `role="radio"` est invalide et casse les lecteurs d'écran).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  navigate: vi.fn(),
  createGroupMutateAsync: vi.fn(),
  acceptInvitationMutateAsync: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => H.navigate,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (selector?: (s: { user: null }) => unknown) =>
    selector ? selector({ user: null }) : { user: null },
}));

vi.mock('@/lib/queries', () => ({
  useCreateGroup: () => ({ mutateAsync: H.createGroupMutateAsync, isPending: false }),
  useAcceptInvitation: () => ({ mutateAsync: H.acceptInvitationMutateAsync, isPending: false }),
}));

import { OnboardingScreen } from './OnboardingScreen';

async function renderStep1() {
  const user = userEvent.setup();
  render(<OnboardingScreen />);
  await user.click(screen.getByRole('button', { name: /continuer/i }));
  return user;
}

describe('OnboardingScreen — étape 1, accessibilité clavier (MAN-119)', () => {
  it('expose un radiogroup avec deux options role="radio"', async () => {
    await renderStep1();

    const group = screen.getByRole('radiogroup');
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(group).toContainElement(option);
    }
  });

  it('un seul Tab depuis l’arrivée sur l’étape suffit à atteindre la première option (roving tabindex)', async () => {
    const user = await renderStep1();

    await user.tab();

    const createOption = screen.getByRole('radio', { name: /créer un groupe/i });
    expect(createOption).toHaveFocus();
  });

  it('Entrée sélectionne l’option focus (aria-checked + champ associé affiché)', async () => {
    const user = await renderStep1();

    await user.tab();
    await user.keyboard('{Enter}');

    const createOption = screen.getByRole('radio', { name: /créer un groupe/i });
    expect(createOption).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/nom du groupe/i)).toBeInTheDocument();
  });

  it('la flèche bas déplace le focus ET la sélection vers l’autre option', async () => {
    const user = await renderStep1();

    await user.tab();
    await user.keyboard('{ArrowDown}');

    const joinOption = screen.getByRole('radio', { name: /rejoindre un groupe/i });
    const createOption = screen.getByRole('radio', { name: /créer un groupe/i });
    expect(joinOption).toHaveFocus();
    expect(joinOption).toHaveAttribute('aria-checked', 'true');
    expect(createOption).toHaveAttribute('aria-checked', 'false');
  });

  it('le champ conditionnel n\'est pas imbriqué dans l\'option (pas de contenu interactif dans un role="radio")', async () => {
    const user = await renderStep1();
    await user.click(screen.getByText(/créer un groupe/i));

    const createOption = screen.getByRole('radio', { name: /créer un groupe/i });
    const input = screen.getByLabelText(/nom du groupe/i);
    expect(createOption).not.toContainElement(input);
  });
});
