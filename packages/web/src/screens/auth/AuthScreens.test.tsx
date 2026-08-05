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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { NX } from '@/lib/tokens';

const H = vi.hoisted(() => {
  const state = {
    user: null as { displayName: string } | null,
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
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
import { ResetPasswordScreen } from './ResetPasswordScreen';

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
  H.state.resetPassword.mockReset().mockResolvedValue(undefined);
  H.state.user = { displayName: 'Manu' };
  H.state.initializing = false;
  // Ne résout jamais par défaut : évite tout effet de bord async pendant les
  // assertions "statiques" (animation, profondeur) d'InviteRedirectScreen.
  H.createGroupMutateAsync.mockReset().mockResolvedValue({ id: 'g1', name: 'demo' });
  H.acceptInvitationMutateAsync.mockReset().mockReturnValue(new Promise(() => undefined));
});

/** La carte animée de `AuthShell`, commune aux 5 écrans. */
function authCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-testid="auth-card"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('Task 1 — animation d’entrée des écrans auth/onboarding (MAN-113)', () => {
  it.each(SCREENS.map((s) => [s.name, s.render] as const))(
    '%s : la carte porte `animate-in` + `fade-in` (tailwindcss-animate)',
    (_name, renderScreen) => {
      const { container } = renderScreen();
      const classes = authCard(container).className.split(/\s+/);

      expect(classes).toContain('animate-in');
      expect(classes).toContain('fade-in');
    },
  );

  it.each(SCREENS.map((s) => [s.name, s.render] as const))(
    '%s : le wrapper racine 100vh n’est pas animé (il peint --nx-bg, l’animer ferait virer toute la page)',
    (_name, renderScreen) => {
      const { container } = renderScreen();
      const root = container.firstElementChild as HTMLElement;

      expect(root.style.minHeight).toBe('100vh');
      expect(root.className.split(/\s+/)).not.toContain('animate-in');
    },
  );

  it('rien ne bloque les interactions pendant l’animation (pas de pointer-events:none)', () => {
    const { container } = render(<LoginScreen />);
    const root = container.firstElementChild as HTMLElement;
    const card = authCard(container);

    for (const el of [root, card]) {
      expect(el.style.pointerEvents).not.toBe('none');
      expect(el.className.split(/\s+/)).not.toContain('pointer-events-none');
    }
  });
});

describe('Task 2 — profondeur visuelle de la carte de formulaire (MAN-113)', () => {
  it.each(SCREENS.map((s) => [s.name, s.render] as const))(
    '%s : la carte applique un token d’ombre et un habillage glass (NX)',
    (_name, renderScreen) => {
      const { container } = renderScreen();
      const style = authCard(container).style;
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

  // Régression de la migration : "Mot de passe oublié" vit *dans* le <form> de
  // login. L'ancien markup posait `type="button"` à la main ; le `Button`
  // partagé doit fournir ce défaut, sinon le clic soumettrait le formulaire
  // (validation déclenchée + shake) en plus de naviguer.
  it('LoginScreen : "Mot de passe oublié", bien que dans le <form>, ne soumet pas le formulaire', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    const link = screen.getByRole('button', { name: /mot de passe oublié/i });
    expect(link).toHaveProperty('type', 'button');

    await user.click(link);

    expect(H.navigate).toHaveBeenCalledWith({ to: '/forgot-password' });
    expect(H.state.login).not.toHaveBeenCalled();
    expect(screen.queryByText(/email requis/i)).toBeNull();
    expect(screen.queryByText(/mot de passe requis/i)).toBeNull();
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

    expect(authCard(container).className).toMatch(/animate-in/);

    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.type(screen.getByLabelText(/mot de passe$/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /se connecter/i }));

    await waitFor(() => expect(H.state.login).toHaveBeenCalledWith('manu@example.com', 'hunter2'));
  });

  it('RegisterScreen : entrée animée + soumission déclenche register()', async () => {
    const user = userEvent.setup();
    const { container } = render(<RegisterScreen />);

    expect(authCard(container).className).toMatch(/animate-in/);

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

    expect(authCard(container).className).toMatch(/animate-in/);

    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }));

    await waitFor(() => expect(H.state.forgotPassword).toHaveBeenCalledWith('manu@example.com'));
  });

  it('OnboardingScreen : entrée animée + parcours "créer un groupe" déclenche createGroup()', async () => {
    const user = userEvent.setup();
    const { container } = render(<OnboardingScreen />);

    expect(authCard(container).className).toMatch(/animate-in/);

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

    expect(authCard(container).className).toMatch(/animate-in/);

    const button = await screen.findByRole('button', { name: /retour à l.app/i });
    await user.click(button);

    expect(H.navigate).toHaveBeenCalledWith({ to: '/app' });
  });
});

describe('Task 6 — ResetPasswordScreen (MAN-171 Phase 1 / MAN-166)', () => {
  afterEach(() => {
    // Évite que le `?token=...` posé par un test fuite vers les suivants
    // (LoginScreen/RegisterScreen lisent aussi `window.location.search`).
    window.history.pushState({}, '', '/');
  });

  it('lit le token depuis l’URL, remplit le formulaire et soumet → resetPassword(token, newPassword)', async () => {
    window.history.pushState({}, '', '/reset-password?token=tok-abc-123');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    await waitFor(() =>
      expect(H.state.resetPassword).toHaveBeenCalledWith('tok-abc-123', 'supersecret123'),
    );
  });

  it('redirige vers /login avec un message de confirmation en cas de succès', async () => {
    window.history.pushState({}, '', '/reset-password?token=tok-abc-123');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    await waitFor(() =>
      expect(H.navigate).toHaveBeenCalledWith({
        to: '/login',
        search: { reset: 'success' },
      }),
    );
  });

  it('affiche un message d’erreur si resetPassword échoue, sans naviguer', async () => {
    H.state.resetPassword.mockReset().mockRejectedValue(new Error('AUTH_RESET_TOKEN_INVALID'));
    window.history.pushState({}, '', '/reset-password?token=tok-expired');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    expect(await screen.findByText(/ce lien n.est plus valable/i)).toBeInTheDocument();
    expect(H.navigate).not.toHaveBeenCalled();
  });

  it('valide que les deux mots de passe correspondent avant tout appel réseau', async () => {
    window.history.pushState({}, '', '/reset-password?token=tok-abc-123');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'autrechose456');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    expect(await screen.findByText(/mots de passe ne correspondent pas/i)).toBeInTheDocument();
    expect(H.state.resetPassword).not.toHaveBeenCalled();
    expect(H.navigate).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordScreen — CTA de redemande de lien sur token invalide (MAN-173, Phase 3 de MAN-166)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('test_reset_password_screen_shows_clear_message_and_cta_on_invalid_token', async () => {
    H.state.resetPassword.mockReset().mockRejectedValue(
      new ApiError(400, {
        code: 'AUTH_RESET_TOKEN_INVALID',
        message: 'Token invalid',
      }),
    );
    window.history.pushState({}, '', '/reset-password?token=tok-expired');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    expect(await screen.findByText(/ce lien n.est plus valable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demander un nouveau lien/i })).toBeInTheDocument();
  });

  it('test_cta_navigates_to_forgot_password', async () => {
    H.state.resetPassword.mockReset().mockRejectedValue(
      new ApiError(400, {
        code: 'AUTH_RESET_TOKEN_INVALID',
        message: 'Token invalid',
      }),
    );
    window.history.pushState({}, '', '/reset-password?token=tok-expired');
    const user = userEvent.setup();
    render(<ResetPasswordScreen />);

    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'supersecret123');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'supersecret123');
    await user.click(screen.getByRole('button', { name: /réinitialiser/i }));

    const cta = await screen.findByRole('button', { name: /demander un nouveau lien/i });
    await user.click(cta);

    expect(H.navigate).toHaveBeenCalledWith({ to: '/forgot-password' });
  });
});

describe('ForgotPasswordScreen — rate limit (MAN-172, Phase 2 anti-abus de MAN-166)', () => {
  it('test_forgot_password_screen_shows_rate_limit_message_on_429', async () => {
    H.state.forgotPassword.mockReset().mockRejectedValue(
      new ApiError(429, {
        code: 'AUTH_FORGOT_PASSWORD_RATE_LIMITED',
        message: 'Too many requests',
      }),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordScreen />);

    await user.type(screen.getByLabelText(/^email$/i), 'manu@example.com');
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }));

    expect(await screen.findByText(/réessaie dans quelques minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/email envoyé/i)).not.toBeInTheDocument();
  });
});
