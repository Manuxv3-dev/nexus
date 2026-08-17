/**
 * Nommage accessible des 6 champs des modales de compte (MAN-245 Phase 1).
 *
 * Zone la plus sensible de l'app (ADR-033 : changement d'email, changement de
 * mot de passe, suppression de compte) et la moins bien nommée avant ce
 * correctif : deux champs sans aucun nom ni placeholder, trois sur placeholder
 * seul, et la confirmation de suppression avec l'email en `placeholder` — donc
 * une **donnée** présentée comme un nom.
 *
 * Chaque test interroge le champ **par son nom accessible**. Ces requêtes
 * échouent toutes sur le code d'avant le correctif — c'est bien le
 * comportement perçu par un lecteur d'écran qui est sous test, pas la
 * structure du DOM.
 *
 * Le harnais de mocks reprend celui de `SettingsScreen.test.tsx` (réduit à ce
 * dont la section Profil a besoin) : `useAuth` est un store zustand piloté par
 * `setState`, le reste est mocké pour garder l'écran hermétique.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';
import type * as TauriModule from '@/lib/tauri';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
const { checkProviderWebviewDataStatusMock } = vi.hoisted(() => ({
  checkProviderWebviewDataStatusMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockRejectedValue(new Error('web')) }));

vi.mock('@/lib/push', () => ({
  getPushSubscriptionStatus: vi.fn().mockResolvedValue('not-subscribed'),
  isPushSupported: vi.fn().mockReturnValue(false),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  setPushPreview: vi.fn(),
  readPushPreview: vi.fn().mockReturnValue(true),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useMessagingSessions: () => ({ data: [] }),
    useNotificationPrefs: () => ({ data: undefined }),
    useUpdateNotificationPrefs: () => ({ mutate: vi.fn() }),
    useConnectWebviewProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteMessagingSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteProviderLocalData: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, checkProviderWebviewDataStatus: checkProviderWebviewDataStatusMock };
});

import { SettingsScreen } from './SettingsScreen';

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

/** Ouvre une modale de compte depuis sa ligne dans la section Profil. */
async function openRow(rowLabel: string) {
  const user = userEvent.setup();
  renderScreen();
  await user.click(screen.getByText(rowLabel));
  return user;
}

describe('Modales de compte — nommage accessible des champs', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    navigateMock.mockReset();
    checkProviderWebviewDataStatusMock.mockReset();
    checkProviderWebviewDataStatusMock.mockResolvedValue({});
  });

  it("le champ nom d'affichage a un nom accessible", async () => {
    // Avant le correctif : ni label, ni aria-label, ni même placeholder.
    await openRow("Nom d'affichage");

    expect(screen.getByRole('textbox', { name: "Nom d'affichage" })).toHaveValue('Manu');
  });

  it('le champ email a un nom accessible', async () => {
    // Avant le correctif : ni label, ni aria-label, ni placeholder.
    await openRow('Email');

    expect(screen.getByRole('textbox', { name: 'Adresse email' })).toHaveValue('manu@example.com');
  });

  it('les trois champs de mot de passe ont chacun un nom accessible distinct', async () => {
    // Avant le correctif : placeholder seul sur les trois. Un placeholder
    // disparaît à la saisie — trois champs masqués et indiscernables.
    await openRow('Mot de passe');

    expect(screen.getByLabelText('Mot de passe actuel')).toBeInTheDocument();
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmer le nouveau mot de passe')).toBeInTheDocument();
  });

  it('la contrainte de longueur du nouveau mot de passe est reliée au champ, pas au placeholder', async () => {
    // Avant : « (12+ caractères) » vivait dans le placeholder, donc perdu dès
    // la première frappe — exactement au moment où la contrainte compte.
    await openRow('Mot de passe');

    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveAccessibleDescription(/12/);
  });

  it('le champ de confirmation de suppression est nommé par son instruction, et l’email est une description', async () => {
    // Avant : `placeholder={email}` — une donnée présentée comme un nom, et
    // l'instruction « saisis ton email » était un <div> frère non associé.
    await openRow('Supprimer mon compte');

    const confirm = screen.getByRole('textbox', {
      name: 'Confirme en saisissant ton adresse email',
    });
    expect(confirm).toHaveAccessibleDescription(expect.stringContaining('manu@example.com'));
    // L'email ne doit plus être le placeholder : ce n'est pas un nom.
    expect(confirm).not.toHaveAttribute('placeholder', 'manu@example.com');
  });
});
