/**
 * GroupsSection — test d'intégration de la création de groupe (MAN-194
 * Phase 3, tâches 1-2).
 *
 * `GroupsSection.test.tsx` mocke `useCreateGroup` : il prouve l'assemblage
 * UI ↔ mutation (bons arguments, gestion d'erreur inline) mais pas la vraie
 * mécanique d'invalidation de cache. Ici, seul `@/lib/api` est mocké — les
 * VRAIS `useGroups`/`useCreateGroup` (`packages/web/src/lib/queries.ts`)
 * tournent — pour prouver que `onSuccess` de `useCreateGroup` (qui invalide
 * `['groups']`) fait bien réapparaître le nouveau groupe dans la liste
 * rendue par `GroupsSection`, sans aucune rustine de state local. Même
 * niveau de mock que `GroupsSection.invitations.integration.test.tsx`
 * (MAN-193 Task 4).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Group } from '@/lib/queries';

const VIEWER_ID = '11111111-1111-1111-1111-111111111111';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

// `GroupMembersPanel` n'est jamais déplié dans ce parcours (aucun groupe au
// départ), mais mocké par cohérence avec les autres tests de ce fichier de
// section — évite de monter tout son arbre de dépendances pour rien.
vi.mock('@/screens/app/GroupMembersPanel', () => ({
  GroupMembersPanel: () => <div data-testid="group-members-panel" />,
}));

import { GroupsSection } from './GroupsSection';

const mockedApi = vi.mocked(api);

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupsSection />
    </QueryClientProvider>,
  );
}

function setViewer() {
  useAuth.setState({
    user: {
      id: VIEWER_ID,
      email: 'moi@example.com',
      displayName: 'Moi',
      avatarUrl: null,
      themePreference: null,
      landingPreference: 'home',
      createdAt: new Date().toISOString(),
    },
    initializing: false,
  });
}

describe('GroupsSection création de groupe (intégration réelle, MAN-194 Phase 3)', () => {
  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    mockedApi.mockReset();
  });

  it('test_new_group_appears_in_list_after_creation', async () => {
    const newGroup: Group = {
      id: '99999999-9999-9999-9999-999999999999',
      name: 'La Bande du 11e',
      createdBy: VIEWER_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: 'owner',
    };

    // 1. GET (montage de la section) : le viewer n'a encore aucun groupe.
    // 2. POST (clic "Créer") : renvoie le groupe créé.
    // 3. GET (refetch déclenché par l'invalidation `onSuccess` de
    //    `useCreateGroup`) : le nouveau groupe apparaît dans la liste.
    mockedApi
      .mockResolvedValueOnce({ groups: [] })
      .mockResolvedValueOnce({ group: newGroup })
      .mockResolvedValueOnce({ groups: [newGroup] });

    setViewer();
    const user = userEvent.setup();
    renderSection();

    await screen.findByText("Tu n'appartiens à aucun groupe pour l'instant.");

    await user.click(screen.getByRole('button', { name: /Créer un groupe/i }));
    await user.type(screen.getByRole('textbox'), 'La Bande du 11e');
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    await waitFor(() => {
      expect(screen.getByText('La Bande du 11e')).toBeInTheDocument();
    });
    // L'état vide a laissé place à la liste : la même mutation ayant réussi,
    // le rôle affiché doit être celui renvoyé par le backend (`owner`), pas
    // recalculé côté client.
    expect(
      screen.queryByText("Tu n'appartiens à aucun groupe pour l'instant."),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Propriétaire')).toBeInTheDocument();
    // L'accordéon reste fermé par défaut même pour le groupe fraîchement créé
    // (même garantie que `test_groups_accordion_closed_by_default` dans
    // `GroupsSection.test.tsx`).
    expect(screen.queryByTestId('group-members-panel')).not.toBeInTheDocument();

    expect(mockedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/groups',
        body: { name: 'La Bande du 11e' },
      }),
    );
  });
});
