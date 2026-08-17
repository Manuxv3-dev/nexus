/**
 * MAN-245 Phase 2 lot 2 — nommage accessible des trois modales restantes.
 *
 * `ExpenseModal` a sa propre suite (`expenses/ExpenseModal.a11y.test.tsx`) : ses
 * deux défauts — `<label>` imbriqués et input de part anonyme — méritaient un
 * fichier dédié. Ici on couvre `PollModal`, `TodoListModal` et `EventModal`.
 *
 * Le défaut commun aux deux premières : `<Field label="Options (n/10)">`
 * enveloppait N inputs dans un `<label>` unique. Or un `<label>` ne s'associe
 * qu'à son **premier** contrôle — l'option 1 était nommée, les options 2 à 10 (et
 * les items 2 à 50) n'avaient qu'un `placeholder`, qui disparaît à la saisie.
 *
 * Les assertions passent par `getByLabelText` plutôt que
 * `getByRole(..., { name })` : ces modales portent `NX.warningBg` en style
 * inline, et le scan de rôles de Testing Library clone les nœuds, ce qui fait
 * planter le parseur du raccourci `background` de jsdom (cf. le commentaire
 * détaillé dans `ExpenseModal.a11y.test.tsx`). `ByLabelText` résout `aria-label`
 * et `htmlFor` sans cloner — même vérification, chemin intact.
 *
 * Le mock de `@/lib/queries` reprend la forme de `modal-a11y.test.tsx` : mock
 * complet du module, comme le fait la suite existante pour ces modales.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EventModal } from './events/EventModal';
import { PollModal } from './polls/PollModal';
import { GROUP_ID } from './testFixtures';
import { TodoListModal } from './todos/TodoListModal';

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({ data: [] })),
  useCreateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useEventRsvp: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreatePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeletePoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useVote: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoList: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTodoItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

describe('PollModal — nommage accessible (MAN-245 Phase 2)', () => {
  it('nomme chaque option individuellement, pas seulement la première', async () => {
    const user = userEvent.setup();
    render(<PollModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    // Deux options par défaut ; on en ajoute une troisième pour vérifier que le
    // nommage suit la liste au lieu de s'arrêter au premier contrôle.
    expect(screen.getByLabelText('Option 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Option 2')).toBeInTheDocument();

    await user.click(screen.getByText('+ Ajouter une option'));

    expect(screen.getByLabelText('Option 3')).toBeInTheDocument();
  });

  it('nomme le groupe des options et les autres champs', () => {
    render(<PollModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    expect(screen.getByRole('group', { name: /^Options \(\d+\/10\)$/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Question')).toBeInTheDocument();
    expect(screen.getByLabelText('Date de clôture (optionnelle)')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags (séparés par virgule)')).toBeInTheDocument();
  });

  it('nomme les boutons de suppression d’option, qui n’ont qu’une icône', async () => {
    const user = userEvent.setup();
    render(<PollModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    // Les boutons n'apparaissent qu'au-delà de 2 options (on ne peut pas
    // descendre sous le minimum).
    await user.click(screen.getByText('+ Ajouter une option'));

    expect(screen.getByLabelText("Supprimer l'option 3")).toBeInTheDocument();
  });
});

describe('TodoListModal — nommage accessible (MAN-245 Phase 2)', () => {
  it('nomme chaque item initial individuellement', async () => {
    const user = userEvent.setup();
    render(<TodoListModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    await user.click(screen.getByText('+ Ajouter un item'));

    expect(screen.getByLabelText('Item 1')).toBeInTheDocument();
    expect(screen.getByLabelText("Supprimer l'item 1")).toBeInTheDocument();
  });

  it('nomme le groupe des items et les autres champs', () => {
    render(<TodoListModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    expect(screen.getByRole('group', { name: 'Items initiaux (optionnels)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Titre')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags (séparés par virgule)')).toBeInTheDocument();
  });
});

describe('EventModal — nommage accessible (MAN-245 Phase 2)', () => {
  it('nomme ses cinq champs, textarea incluse', () => {
    render(<EventModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);

    // Ces cinq passaient déjà par le helper local (correct pour un contrôle
    // unique) : le test verrouille qu'ils survivent à la migration vers la
    // primitive partagée. La textarea est incluse explicitement — c'est le seul
    // contrôle non-`input` de la série, donc celui qu'un portage bâclé
    // oublierait.
    expect(screen.getByLabelText('Titre')).toBeInTheDocument();
    expect(screen.getByLabelText('Date et heure')).toBeInTheDocument();
    expect(screen.getByLabelText('Lieu (optionnel)')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optionnelle)').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Tags (séparés par virgule)')).toBeInTheDocument();
  });
});
