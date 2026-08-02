/**
 * Tests des 5 écrans auth/onboarding (MAN-113 — Affinage UI Phase 4).
 *
 * Toutes les dépendances externes (router, store auth, mutations React Query)
 * sont mockées via `vi.hoisted` : ces écrans ne testent pas l'intégration
 * réseau (déjà couverte ailleurs), mais l'habillage (animation d'entrée,
 * profondeur visuelle) et la migration vers le `Button` partagé (MAN-110).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NX } from '@/lib/tokens';

const H = vi.hoisted(() => {
  const state = {
    user: null as { displayName: string } | null,
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
  };
  return {
    state,
    navigate: vi.fn(),
    params: { slug: 'demo-invite-slug' },
    createGroupMutateAsync: vi.fn(),
    acceptInvitationMutateAsync: vi.fn(),
  };
});

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => H.navigate,
  useParams: () => H.params,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (selector?: (s: typeof H.state) => unknown) => (selector ? selector(H.state) : H.state),
}));

vi.mock('@/lib/queries', () => ({
  useCreateGroup: () => ({ mutateAsync: H.createGroupMutateAsync, isPending: false }),
  useAcceptInvitation: () => ({ mutateAsync: H.acceptInvitationMutateAsync, isPending: false }),
}));

import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { InviteRedirectScreen } from './InviteRedirectScreen';
import { LoginScreen } from './LoginScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { RegisterScreen } from './RegisterScreen';

/** Marqueurs de classes portés par toutes les variantes du `Button` partagé
 * (MAN-110) — présents quel que soit variant/size/className d'override. */
const BUTTON_MARKER_CLASSES = ['ease-nx-spring', 'active:scale-[0.96]'];

function expectSharedButton(button: HTMLElement) {
  const classes = button.className.split(/\s+/);
  for (const marker of BUTTON_MARKER_CLASSES) {
    expect(classes).toContain(marker);
  }
}

const SCREENS = [
  { name: 'LoginScreen', render: () => render(<LoginScreen />) },
  { name: 'RegisterScreen', render: () => render(<RegisterScreen />) },
  { name: 'OnboardingScreen', render: () => render(<OnboardingScreen />) },
  { name: 'ForgotPasswordScreen', render: () => render(<ForgotPasswordScreen />) },
  { name: 'InviteRedirectScreen', render: () => render(<InviteRedirectScreen />) },
] as const;

beforeEach(() => {
  H.navigate.mockReset();
  H.state.login.mockReset().mockResolvedValue({ id: 'u1', displayName: 'Manu' });
  H.state.register.mockReset().mockResolvedValue({ id: 'u1', displayName: 'Manu' });
  H.state.forgotPassword.mockReset().mockResolvedValue(undefined);
  H.state.user = { displayName: 'Manu' };
  H.state.initializing = false;
  // Ne résout jamais par défaut : évite tout effet de bord async pendant les
  // assertions "statiques" (animation, profondeur) d'InviteRedirectScreen.
  H.createGroupMutateAsync.mockReset().mockResolvedValue({ id: 'g1', name: 'demo' });
  H.acceptInvitationMutateAsync.mockReset().mockReturnValue(new Promise(() => undefined));
});

describe('Task 1 — animation d’entrée des écrans auth/onboarding (MAN-113)', () => {
  it.each(SCREENS.map((s) => [s.name, s.render] as const))(
    '%s : le wrapper racine porte `animate-in` + `fade-in` (tailwindcss-animate)',
    (_name, renderScreen) => {
      const { container } = renderScreen();
      const root = container.firstElementChild;
      expect(root).not.toBeNull();
      const classes = (root as HTMLElement).className.split(/\s+/);

      expect(classes).toContain('animate-in');
      expect(classes).toContain('fade-in');
    },
  );

  it('le wrapper racine ne bloque jamais les interactions pendant l’animation (pas de pointer-events:none)', () => {
    const { container } = render(<LoginScreen />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.style.pointerEvents).not.toBe('none');
    expect(root.className.split(/\s+/)).not.toContain('pointer-events-none');
  });
});

describe('Task 2 — profondeur visuelle de la carte de formulaire (MAN-113)', () => {
  it.each(SCREENS.map((s) => [s.name, s.render] as const))(
    '%s : la carte applique un token d’ombre et un habillage glass (NX)',
    (_name, renderScreen) => {
      const { container } = renderScreen();
      const card = container.querySelector('[data-testid="auth-card"]');
      expect(card).not.toBeNull();

      const style = (card as HTMLElement).style;
      expect([NX.shadowSm, NX.shadowMd]).toContain(style.boxShadow);
      expect(style.backdropFilter).toBe(NX.glassBlur);
      expect(style.border).toContain(NX.glassBorder);
    },
  );
});

describe('Task 3 — migration des boutons d’action bruts vers le Button partagé (MAN-113)', () => {
  it('LoginScreen : "Se connecter", "Mot de passe oublié" et "Créer un compte" utilisent le Button partagé', () => {
    render(<LoginScreen />);
    expectSharedButton(screen.getByRole('button', { name: /se connecter/i }));
    expectSharedButton(screen.getByRole('button', { name: /mot de passe oublié/i }));
    expectSharedButton(screen.getByRole('button', { name: /créer un compte/i }));
  });

  it('RegisterScreen : "Créer mon compte" et "Se connecter" utilisent le Button partagé', () => {
    render(<RegisterScreen />);
    expectSharedButton(screen.getByRole('button', { name: /créer mon compte/i }));
    expectSharedButton(screen.getByRole('button', { name: /se connecter/i }));
  });

  it('OnboardingScreen : "Continuer" utilise le Button partagé', () => {
    render(<OnboardingScreen />);
    expectSharedButton(screen.getByRole('button', { name: /continuer/i }));
  });

  it('ForgotPasswordScreen : "Envoyer le lien" et "Retour à la connexion" utilisent le Button partagé', () => {
    render(<ForgotPasswordScreen />);
    expectSharedButton(screen.getByRole('button', { name: /envoyer le lien/i }));
    expectSharedButton(screen.getByRole('button', { name: /retour à la connexion/i }));
  });

  it('InviteRedirectScreen : "Retour à l’app" (état erreur) utilise le Button partagé', async () => {
    H.acceptInvitationMutateAsync.mockReset().mockRejectedValue(new Error('slug invalide'));
    render(<InviteRedirectScreen />);

    const button = await screen.findByRole('button', { name: /retour à l.app/i });
    expectSharedButton(button);
  });
});

describe('Task 4 — test d’acceptation du slice (animation + action principale fonctionnelle)', () => {
  it('LoginScreen : entrée animée + soumission déclenche login()', async () => {
    const user = userEvent.setup();
    const { container } = render(<LoginScreen />);

    expect(container.firstElementChild?.className).toMatch(/animate-in/);

    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.type(screen.getByLabelText(/mot de passe$/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /se connecter/i }));

    await waitFor(() => expect(H.state.login).toHaveBeenCalledWith('manu@example.com', 'hunter2'));
  });

  it('RegisterScreen : entrée animée + soumission déclenche register()', async () => {
    const user = userEvent.setup();
    const { container } = render(<RegisterScreen />);

    expect(container.firstElementChild?.className).toMatch(/animate-in/);

    await user.type(screen.getByLabelText(/prénom ou pseudo/i), 'Manu');
    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.type(screen.getByLabelText(/mot de passe$/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }));

    await waitFor(() =>
      expect(H.state.register).toHaveBeenCalledWith('manu@example.com', 'supersecret123', 'Manu'),
    );
  });

  it('ForgotPasswordScreen : entrée animée + soumission déclenche forgotPassword()', async () => {
    const user = userEvent.setup();
    const { container } = render(<ForgotPasswordScreen />);

    expect(container.firstElementChild?.className).toMatch(/animate-in/);

    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }));

    await waitFor(() => expect(H.state.forgotPassword).toHaveBeenCalledWith('manu@example.com'));
  });

  it('OnboardingScreen : entrée animée + parcours "créer un groupe" déclenche createGroup()', async () => {
    const user = userEvent.setup();
    const { container } = render(<OnboardingScreen />);

    expect(container.firstElementChild?.className).toMatch(/animate-in/);

    await user.click(screen.getByRole('button', { name: /continuer/i }));
    await user.click(screen.getByText(/créer un groupe/i));
    await user.type(screen.getByLabelText(/nom du groupe/i), 'La Bande du 11e');
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }));

    await waitFor(() =>
      expect(H.createGroupMutateAsync).toHaveBeenCalledWith({ name: 'La Bande du 11e' }),
    );
  });

  it('InviteRedirectScreen : entrée animée + "Retour à l’app" (état erreur) déclenche la navigation', async () => {
    H.acceptInvitationMutateAsync.mockReset().mockRejectedValue(new Error('slug invalide'));
    const user = userEvent.setup();
    const { container } = render(<InviteRedirectScreen />);

    expect(container.firstElementChild?.className).toMatch(/animate-in/);

    const button = await screen.findByRole('button', { name: /retour à l.app/i });
    await user.click(button);

    expect(H.navigate).toHaveBeenCalledWith({ to: '/app' });
  });
});
