/**
 * SettingsScreen — responsive mobile (ticket f0ebfd17).
 *
 * `/settings` était un rail à deux colonnes en dur (240px de rail + contenu),
 * jamais pensé pour un viewport mobile : sous 768px il ne restait plus que
 * ~150px de contenu, inutilisable (`CreateGroupForm` et consorts débordent).
 * `useIsMobile()` (`lib/useMedia.ts`, même hook que `ResponsiveAppShell` pour
 * `/app`) bascule désormais l'écran vers une navigation par stack (liste des
 * sections en pleine largeur -> section choisie, avec un retour) ; le layout
 * desktop reste inchangé.
 *
 * `window.matchMedia` est stubbé en branche DESKTOP par défaut
 * (`matches: false`, cf. `test/setup.ts`) : les tests mobile ci-dessous le
 * réaffectent localement en `matches: true` — même convention que
 * `GlassDialogShell.test.tsx` (`mockMobileMatchMedia`).
 *
 * Harnais de mocks réduit au strict nécessaire (mêmes mocks que
 * `SettingsScreen.accountFields.test.tsx`) : la section choisie pour les
 * tests d'assemblage liste/détail/retour est "Sécurité", la seule des 5 à ne
 * dépendre d'aucun hook réseau (`AboutSection` ne lit que `isTauri()`, faux
 * par défaut en test). `useGroups` est tout de même mocké pour le test
 * "Groupes" ci-dessous, qui prouve que `SettingsSectionDetail` n'entrave pas
 * une section à hooks réseau.
 *
 * Le bouton retour de l'étape 2 porte un nom accessible explicite
 * (`aria-label="Retour aux réglages"`, distinct du texte visible "Réglages")
 * — cf. `SettingsScreen.mobile.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isPending: false, isError: false, isLoading: false }),
  };
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

const SECURITY_SUBTITLE = 'Sessions actives, acces aux appareils';

/** Réaffecte `window.matchMedia` sur la branche mobile (`matches: true`). */
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

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

describe('SettingsScreen — responsive', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    navigateMock.mockReset();
  });

  describe('mobile (< 768px)', () => {
    beforeEach(() => {
      mockMobileMatchMedia();
    });

    it('affiche la liste des sections en pleine largeur, pas le rail desktop', () => {
      const { container } = renderScreen();

      expect(container.querySelector('aside')).not.toBeInTheDocument();
      for (const label of [
        'Profil',
        'Groupes',
        'Notifications',
        'Connexions messageries',
        'Sécurité',
      ]) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });

    it('le bouton de sortie vers /app reste accessible depuis la liste', () => {
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: /nexus/ }));

      expect(navigateMock).toHaveBeenCalledWith({ to: '/app' });
    });

    it('cliquer une section affiche son contenu avec un bouton retour', () => {
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: 'Sécurité' }));

      expect(screen.getByText(SECURITY_SUBTITLE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retour aux réglages' })).toBeInTheDocument();
    });

    it('le retour ramène à la liste des sections', () => {
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: 'Sécurité' }));
      fireEvent.click(screen.getByRole('button', { name: 'Retour aux réglages' }));

      expect(screen.getByRole('button', { name: 'Groupes' })).toBeInTheDocument();
      expect(screen.queryByText(SECURITY_SUBTITLE)).not.toBeInTheDocument();
    });

    // Une section à hooks réseau (contrairement à "Sécurité" ci-dessus) :
    // prouve que `SettingsSectionDetail` (le wrapper avec retour) ne gêne pas
    // le montage d'une section qui dépend de TanStack Query.
    it('une section à hooks réseau (Groupes) se monte normalement dans le wrapper détail', () => {
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: 'Groupes' }));

      expect(screen.getByText('Gère les membres de tes groupes')).toBeInTheDocument();
    });
  });

  describe('desktop (>= 768px, comportement historique)', () => {
    it('garde le rail à deux colonnes ; navigation et contenu restent visibles ensemble', () => {
      const { container } = renderScreen();

      const aside = container.querySelector('aside');
      expect(aside).toBeInTheDocument();
      expect(aside).toHaveStyle({ width: '240px' });

      fireEvent.click(screen.getByRole('button', { name: 'Sécurité' }));

      // Contrairement au mobile : pas de bouton de retour, la sidebar (donc
      // l'onglet "Groupes") reste affichée à côté du contenu.
      expect(screen.getByRole('button', { name: 'Groupes' })).toBeInTheDocument();
      expect(screen.getByText(SECURITY_SUBTITLE)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retour aux réglages' })).not.toBeInTheDocument();
    });
  });
});
