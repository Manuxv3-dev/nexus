/**
 * MAN-245 Phase 3 — collisions d'`id` entre deux `GroupMembersPanel`.
 *
 * `GroupsSection` garde les accordéons ouverts dans un `Set`, donc plusieurs
 * panels peuvent être montés **en même temps**. Les `id` étaient soit statiques
 * (`transfer-ownership-hint`), soit dérivés du seul `userId`
 * (`role-toggle-hint-${userId}`) — un même utilisateur présent dans deux groupes
 * dépliés produisait donc un doublon.
 *
 * Conséquence : `getElementById` s'arrête à la première occurrence, donc tous
 * les `aria-describedby` du second panel résolvaient vers le texte du premier.
 * Un lecteur d'écran lisait l'explication du mauvais groupe — un bug silencieux,
 * invisible à l'œil.
 *
 * Le test monte deux panels avec un membre commun et vérifie l'invariant
 * directement : aucun `id` dupliqué dans le document, et chaque
 * `aria-describedby` résout **à l'intérieur de son propre panel**.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';

// Rôle `admin` délibérément : un viewer admin ne peut pas gérer un autre admin,
// donc les actions sont grisées et leurs hints `sr-only` (`role-toggle-hint-*`,
// `remove-hint-*`) sont RENDUS. Avec un membre `member`, `canManage` serait vrai,
// aucun hint ne serait rendu, et le test ne prouverait rien sur ces `id` — c'est
// exactement ce que la vérification par mutation a révélé sur une première
// version de ce fichier.
const SHARED_MEMBER = {
  userId: 'u-shared',
  displayName: 'Membre Commun',
  role: 'admin' as const,
  joinedAt: new Date().toISOString(),
};

const VIEWER = {
  userId: 'u-viewer',
  displayName: 'Manu',
  role: 'admin' as const,
  joinedAt: new Date().toISOString(),
};

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    // Les DEUX panels reçoivent le même membre — c'est la condition qui
    // produisait le doublon d'`id`.
    useGroupMembers: () => ({
      data: [VIEWER, SHARED_MEMBER],
      isLoading: false,
      isError: false,
      isPending: false,
    }),
    useUpdateGroupMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRemoveGroupMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useLeaveGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTransferGroupOwnership: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { GroupMembersPanel } from './GroupMembersPanel';

const TEST_USER = {
  id: 'u-viewer',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderTwoPanels() {
  useAuth.setState({ user: TEST_USER, initializing: false });
  // `importOriginal` laisse des hooks réels dans le module mocké : le provider
  // est donc nécessaire même si toutes les queries utilisées ici sont mockées.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <div data-testid="panel-a">
        <GroupMembersPanel groupId="group-a" viewerRole="admin" />
      </div>
      <div data-testid="panel-b">
        <GroupMembersPanel groupId="group-b" viewerRole="admin" />
      </div>
    </QueryClientProvider>,
  );
}

describe('GroupMembersPanel — deux panels montés simultanément (MAN-245 Phase 3)', () => {
  it('ne produit aucun `id` en doublon dans le document', () => {
    const { container } = renderTwoPanels();

    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

    expect(duplicates).toEqual([]);
  });

  it('chaque aria-describedby résout dans son propre panel', () => {
    renderTwoPanels();

    const panelB = screen.getByTestId('panel-b');
    const describedInB = Array.from(panelB.querySelectorAll('[aria-describedby]'));

    // Il doit y en avoir, sinon le test ne prouve rien.
    expect(describedInB.length).toBeGreaterThan(0);

    for (const el of describedInB) {
      for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) {
        // La cible existe...
        const target = document.getElementById(id);
        expect(target).not.toBeNull();
        // ...et elle vit dans le MÊME panel. Avant le correctif,
        // `getElementById` renvoyait l'occurrence du panel A.
        expect(panelB.contains(target)).toBe(true);
      }
    }
  });

  it('les hints de chaque ligne membre sont distincts entre les deux panels', () => {
    renderTwoPanels();

    const idsIn = (testId: string) =>
      Array.from(within(screen.getByTestId(testId)).getAllByRole('button'))
        .map((b) => b.getAttribute('aria-describedby'))
        .filter((v): v is string => Boolean(v));

    const a = idsIn('panel-a');
    const b = idsIn('panel-b');

    expect(a.length).toBeGreaterThan(0);
    // Aucun identifiant de description partagé entre les deux panels, alors que
    // les deux listent le même membre.
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });
});
