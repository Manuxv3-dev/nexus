/**
 * MobileShell — tests du shell mobile (MAN-111 Phase 2 : habillage & entrée
 * du shell/nav).
 *
 * `useAuth` est un store zustand : piloté directement via `setState`. Les
 * hooks réseau (`@/lib/queries`) sont mockés pour éviter tout appel réel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
  };
});

import { MobileShell } from './MobileShell';

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MobileShell />
    </QueryClientProvider>,
  );
}

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  createdAt: new Date().toISOString(),
};

describe('MobileShell', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
  });

  describe('animation d’entrée (MAN-111 Task 1)', () => {
    it('porte les classes tailwindcss-animate sur le conteneur racine au montage', () => {
      const { container } = renderShell();
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\banimate-in\b/);
      expect(root.className).toMatch(/\bfade-in\b/);
      expect(root.className).toMatch(/\bzoom-in-/);
    });

    it('ne rejoue pas l’animation lors d’un re-render sans démontage (ex: switch d’écran)', () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container, rerender } = render(
        <QueryClientProvider client={qc}>
          <MobileShell />
        </QueryClientProvider>,
      );
      const rootBefore = container.firstElementChild;
      const classesBefore = (rootBefore as HTMLElement).className;

      rerender(
        <QueryClientProvider client={qc}>
          <MobileShell />
        </QueryClientProvider>,
      );

      const rootAfter = container.firstElementChild;
      expect(rootAfter).toBe(rootBefore);
      expect((rootAfter as HTMLElement).className).toBe(classesBefore);
    });
  });
});
