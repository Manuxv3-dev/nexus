/**
 * CreateGroupForm — tests du formulaire de création de groupe partagé
 * (MAN-200, extrait de `NewGroupButton`/`AppShell.tsx` et
 * `CreateGroupButton`/`GroupsSection.tsx`).
 *
 * Couvre ici la logique propre au composant partagé (validation nom vide,
 * gestion clavier Enter/Escape, désactivation pendant la mutation, clic
 * extérieur conditionnel à `closeOnOutsideClick`) une seule fois, plutôt que
 * de dupliquer cette couverture dans les suites de chaque appelant —
 * `AppShell.test.tsx` et `GroupsSection.test.tsx` gardent des tests
 * d'intégration plus fins (montage via le vrai bouton déclencheur, gabarits
 * `prominent`/popover) qui prouvent le bon câblage plutôt que de re-tester
 * cette logique.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '@/lib/queries';
import type * as QueriesModule from '@/lib/queries';

const NEW_GROUP: Group = {
  id: '99999999-9999-9999-9999-999999999999',
  name: 'La Bande du 11e',
  createdBy: 'someone',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

let createGroupMutateAsync = vi.fn(
  (input: { name: string }): Promise<Group> => Promise.resolve({ ...NEW_GROUP, name: input.name }),
);
let createGroupPending = false;

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useCreateGroup: () => ({
      mutateAsync: createGroupMutateAsync,
      isPending: createGroupPending,
    }),
  };
});

import { CreateGroupForm } from './CreateGroupForm';

function renderForm(props: Partial<ComponentProps<typeof CreateGroupForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <div>
        <button type="button">Hors du form</button>
        <CreateGroupForm onClose={onClose} {...props} />
      </div>
    </QueryClientProvider>,
  );
  return { onClose, ...utils };
}

describe('CreateGroupForm', () => {
  afterEach(() => {
    createGroupMutateAsync = vi.fn(
      (input: { name: string }): Promise<Group> =>
        Promise.resolve({ ...NEW_GROUP, name: input.name }),
    );
    createGroupPending = false;
  });

  it('affiche une erreur inline et ne soumet pas si le nom est vide (le bouton Créer reste cliquable)', async () => {
    const user = userEvent.setup();
    renderForm();

    const submitButton = screen.getByRole('button', { name: 'Créer' });
    expect(submitButton).not.toBeDisabled();

    await user.click(submitButton);

    expect(screen.getByText('Le nom est obligatoire.')).toBeInTheDocument();
    expect(createGroupMutateAsync).not.toHaveBeenCalled();
  });

  it('soumet le nom trimé et appelle onClose + onCreated à succès', async () => {
    const onCreated = vi.fn();
    const { onClose } = renderForm({ onCreated });
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), '  Nouvelle Bande  ');
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(createGroupMutateAsync).toHaveBeenCalledWith({ name: 'Nouvelle Bande' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nouvelle Bande' }));
  });

  it('n’appelle pas onCreated quand la prop n’est pas fournie (usage GroupsSection)', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'Nouvelle Bande');
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(createGroupMutateAsync).toHaveBeenCalledWith({ name: 'Nouvelle Bande' });
  });

  it('un Enter sur le bouton Créer ne soumet qu’une seule fois (régression MAN-199/MAN-194)', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'Nouvelle Bande');
    screen.getByRole('button', { name: 'Créer' }).focus();
    await user.keyboard('{Enter}');

    expect(createGroupMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('un Enter sur le bouton Annuler ne soumet pas et ferme le form', async () => {
    const { onClose } = renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'Nouvelle Bande');
    screen.getByRole('button', { name: 'Annuler' }).focus();
    await user.keyboard('{Enter}');

    expect(createGroupMutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape ferme le form', async () => {
    const { onClose } = renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'Nouvelle Bande');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('désactive input et bouton Annuler pendant la mutation (isPending)', () => {
    createGroupPending = true;
    renderForm();

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled();
  });

  it('ferme au clic extérieur quand closeOnOutsideClick est actif', async () => {
    const { onClose } = renderForm({ closeOnOutsideClick: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hors du form' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ne ferme pas au clic extérieur par défaut (closeOnOutsideClick omis, usage inline Settings)', async () => {
    const { onClose } = renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hors du form' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic dans le form (ex: sur l’input) ne déclenche pas la fermeture extérieure', async () => {
    const { onClose } = renderForm({ closeOnOutsideClick: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole('textbox'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
