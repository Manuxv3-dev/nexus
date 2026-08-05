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
import { useRef } from 'react';
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

  // Revue MAN-200 (Fix 1&2) : `boundaryRef`, quand fourni, remplace le
  // `<form>` comme frontière du clic extérieur — il doit couvrir tout élément
  // du conteneur englobant côté appelant (ex: le titre de la popover), pas
  // seulement le formulaire lui-même. Sans ça, un mousedown sur ce genre
  // d'élément visuel comptait comme "extérieur" et fermait le form en perdant
  // le nom tapé.
  it('un clic dans le boundaryRef mais hors du <form> ne ferme pas (frontière élargie)', async () => {
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Wrapper() {
      const boundaryRef = useRef<HTMLDivElement>(null);
      return (
        <div ref={boundaryRef}>
          <div>Nouveau groupe</div>
          <CreateGroupForm onClose={onClose} closeOnOutsideClick boundaryRef={boundaryRef} />
        </div>
      );
    }

    render(
      <QueryClientProvider client={qc}>
        <Wrapper />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByText('Nouveau groupe'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic hors du boundaryRef ferme malgré tout (la frontière élargie ne désactive pas la fermeture)', async () => {
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Wrapper() {
      const boundaryRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <button type="button">Hors du conteneur</button>
          <div ref={boundaryRef}>
            <div>Nouveau groupe</div>
            <CreateGroupForm onClose={onClose} closeOnOutsideClick boundaryRef={boundaryRef} />
          </div>
        </div>
      );
    }

    render(
      <QueryClientProvider client={qc}>
        <Wrapper />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hors du conteneur' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Fix 4 (revue MAN-200) : une mutation en vol ne doit pas se faire couper
  // l'herbe sous le pied par Escape/clic extérieur — sinon le formulaire
  // démonte pendant que la requête est encore en cours, et un remontage
  // ultérieur repart d'un `useCreateGroup()` frais dont `isPending` ignore la
  // requête toujours en vol (double `POST /groups` possible).
  it('Escape n’a pas d’effet pendant une mutation en cours (isPending)', async () => {
    createGroupPending = true;
    const { onClose } = renderForm({ closeOnOutsideClick: true });
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic extérieur n’a pas d’effet pendant une mutation en cours (isPending)', async () => {
    createGroupPending = true;
    const { onClose } = renderForm({ closeOnOutsideClick: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hors du form' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  // Fix 5 (revue MAN-200) : le chemin d'échec de la mutation n'avait aucune
  // couverture — on vérifie ici que l'erreur inline reprend bien le message
  // de l'exception rejetée (`catch (err) { setError(err instanceof Error ...) }`)
  // et que le form reste monté (pas d'appel à `onClose`) pour permettre un
  // retry.
  it('affiche l’erreur inline du message rejeté et ne ferme pas le form si la mutation échoue', async () => {
    createGroupMutateAsync = vi.fn(() => Promise.reject(new Error('Ce nom est déjà pris.')));
    const { onClose } = renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'Nouvelle Bande');
    await user.click(screen.getByRole('button', { name: 'Créer' }));

    expect(await screen.findByText('Ce nom est déjà pris.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
