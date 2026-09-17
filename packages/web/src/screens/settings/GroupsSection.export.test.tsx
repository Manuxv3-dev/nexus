/**
 * GroupsSection — bouton "Exporter le groupe (JSON)" (ticket 645f29ca).
 *
 * Même niveau de mock que `GroupsSection.test.tsx` (`useGroups` mocké,
 * `GroupMembersPanel` mocké — son propre comportement est couvert ailleurs).
 * `@/lib/api` est mocké en plus, comme `GroupsSection.create.integration.test.tsx`,
 * mais ici pour vérifier l'appel et son enchaînement avec le téléchargement
 * (`Blob` + `<a download>`), pas une vraie invalidation de cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import type { Group } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const GROUP_OWNER: Group = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Groupe Owner',
  createdBy: '11111111-1111-1111-1111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};
const GROUP_MEMBER: Group = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Groupe Membre',
  createdBy: '44444444-4444-4444-4444-444444444444',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

let groupsState: Group[] = [GROUP_OWNER, GROUP_MEMBER];

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: groupsState, isPending: false, isError: false }),
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

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

const EXPORT_PAYLOAD = {
  formatVersion: 1,
  exportedAt: '2026-09-17T10:00:00.000Z',
  exportedBy: 'some-user-id',
  group: { id: GROUP_OWNER.id, name: GROUP_OWNER.name },
  members: [],
  events: [],
  polls: [],
  expenses: [],
  todoLists: [],
};

describe('GroupsSection — export JSON du groupe', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    groupsState = [GROUP_OWNER, GROUP_MEMBER];
    // jsdom n'implémente pas `URL.createObjectURL`/`revokeObjectURL` (vérifié
    // empiriquement : `typeof URL.createObjectURL === 'undefined'`).
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    // jsdom logue "Not implemented: navigation to another Document" sur un
    // clic natif d'ancre `blob:` — on n'a pas besoin de la vraie navigation,
    // seulement de prouver qu'elle a été déclenchée.
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    mockedApi.mockReset();
    anchorClick.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('test_export_button_visible_for_owner_absent_for_member', async () => {
    mockedApi.mockResolvedValue(EXPORT_PAYLOAD);
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Groupe Owner/ }));
    await user.click(screen.getByRole('button', { name: /Groupe Membre/ }));

    // Les deux accordéons sont ouverts (non exclusifs) : le bouton export ne
    // doit apparaître qu'une fois — sous la carte owner, jamais sous membre.
    expect(screen.getAllByRole('button', { name: /Exporter le groupe \(JSON\)/ })).toHaveLength(1);
  });

  it('test_export_click_calls_api_and_triggers_blob_download', async () => {
    mockedApi.mockResolvedValue(EXPORT_PAYLOAD);
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Groupe Owner/ }));
    await user.click(screen.getByRole('button', { name: /Exporter le groupe \(JSON\)/ }));

    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith({
        method: 'GET',
        path: `/groups/${GROUP_OWNER.id}/export`,
      });
    });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(await screen.findByText(/téléchargé/)).toBeInTheDocument();
  });

  it('test_export_click_shows_error_toast_on_api_failure', async () => {
    mockedApi.mockRejectedValue(
      new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Permission denied' }),
    );
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Groupe Owner/ }));
    await user.click(screen.getByRole('button', { name: /Exporter le groupe \(JSON\)/ }));

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
