/**
 * Zones de clic sous Tauri — invariants de la bande supérieure de fenêtre.
 *
 * Contexte du bug : `TitleBar` posait une drag region invisible en overlay
 * flottant (`position:fixed`, `height:32`, `zIndex:90`, `pointerEvents:'auto'`)
 * par-dessus toute la largeur du haut de fenêtre. Le hit-test s'arrêtait sur
 * l'overlay, donc les contrôles rendus dans cette bande — au premier chef le
 * bouton « Home nexus », recouvert sur 24 de ses 34 px — ne recevaient jamais
 * le clic : la fenêtre se déplaçait à la place.
 *
 * Le handler de Tauri (`src/window/scripts/drag.js`) sait déjà ne pas draguer
 * depuis un élément cliquable — mais il raisonne sur le `composedPath`, donc
 * sur l'**ascendance DOM**. Un overlay est un frère, pas un ancêtre : la
 * protection ne pouvait pas s'appliquer.
 *
 * D'où les deux invariants testés ici :
 *
 *  1. Aucune drag region n'est un calque flottant — toute drag region est un
 *     conteneur réel, donc ancêtre des contrôles qu'elle couvre, ce qui rend
 *     la protection de Tauri opérante.
 *  2. Les contrôles de la bande supérieure descendent bien d'une drag region
 *     (sinon la fenêtre n'est plus déplaçable depuis le haut).
 *
 * Le cluster des boutons fenêtre (`zIndex:200`, 138 px à droite) reste
 * volontairement flottant : c'est lui qui doit rester au-dessus des webviews
 * provider, et il ne porte pas d'attribut de drag.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: () => '',
  };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: undefined, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
    useEvents: () => ({ data: [], isLoading: false }),
    usePolls: () => ({ data: [], isLoading: false }),
    useExpenses: () => ({ data: [], isLoading: false }),
    useTodoLists: () => ({ data: [], isLoading: false }),
    useActivityFeed: () => ({ data: [], isLoading: false, isError: false }),
  };
});

import { AppShell } from './AppShell';
import { TITLEBAR_HEIGHT, TitleBar, topBandOffset } from './TitleBar';

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

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>,
  );
}

/** Une drag region « flottante » recouvre du contenu qu'elle ne contient pas. */
function isFloating(el: HTMLElement): boolean {
  return el.style.position === 'fixed' || el.style.position === 'absolute';
}

describe('drag region Tauri — zones de clic de la bande supérieure', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
    navigateMock.mockClear();
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    useAuth.setState({ user: null, initializing: true });
  });

  describe('TitleBar', () => {
    it('ne pose aucune drag region en calque flottant', () => {
      const { container } = render(<TitleBar />);

      const regions = Array.from(
        container.querySelectorAll<HTMLElement>('[data-tauri-drag-region]'),
      );

      // Le bug d'origine : un `position:fixed` couvrant toute la largeur du
      // haut de fenêtre, qui interceptait le hit-test avant les boutons.
      expect(regions.filter(isFloating)).toEqual([]);
    });

    it('conserve les boutons fenêtre, qui eux doivent rester flottants', () => {
      render(<TitleBar />);

      // Le cluster reste au-dessus des webviews provider (z-index ignoré par
      // les guests Chromium) — c'est sa raison d'être, on ne la casse pas.
      for (const name of ['Réduire', 'Agrandir', 'Fermer']) {
        const button = screen.getByRole('button', { name });
        expect(button).toBeInTheDocument();
        expect(button.hasAttribute('data-tauri-drag-region')).toBe(false);
      }
    });
  });

  describe('AppShell', () => {
    it('rend le bouton « Home nexus » cliquable : sa drag region est un ancêtre, pas un calque', () => {
      renderShell();

      const home = screen.getByRole('button', { name: 'Home nexus' });
      const region = home.closest('[data-tauri-drag-region]');

      // Ancêtre ⇒ `isDragRegion` de Tauri remonte le composedPath, croise le
      // <button> avant la drag region, et bloque le drag : le clic arrive.
      expect(region).not.toBeNull();
      expect(region).not.toBe(home);
    });
  });

  describe('topBandOffset — ancrage des flottants ancrés en haut', () => {
    it('dégage la bande des boutons fenêtre sous Tauri', () => {
      // Le cluster fenêtre occupe les 138 px de droite sur TITLEBAR_HEIGHT de
      // haut, avec un zIndex de 200 : un flottant ancré à droite dans cette
      // bande (toast de rappel) reçoit les clics de min/max/close à sa place.
      expect(topBandOffset(16)).toBeGreaterThanOrEqual(TITLEBAR_HEIGHT);
    });

    it('laisse l’ancrage web intact hors Tauri', () => {
      delete window.__TAURI_INTERNALS__;

      // Aucun cluster fenêtre en navigateur : rien à dégager, l'ancrage de
      // design d'origine doit être rendu tel quel.
      expect(topBandOffset(16)).toBe(16);
    });
  });
});
