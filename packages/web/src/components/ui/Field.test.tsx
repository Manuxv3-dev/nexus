/**
 * `<Field>` / `<FieldSet>` — primitives de nommage accessible (MAN-245 Phase 1).
 *
 * Ces tests interrogent **par nom accessible** (`getByRole(..., { name })`,
 * `getByLabelText`) plutôt que par structure DOM. C'est délibéré : le défaut
 * corrigé par MAN-245 est précisément qu'un champ n'a pas de nom accessible,
 * donc la requête qui échoue avant le correctif et passe après est la requête
 * par nom. Assertion sur `htmlFor`/`id` bruts serait un test de
 * l'implémentation ; ici on teste ce qu'un lecteur d'écran perçoit.
 *
 * `<Field>` prend ses children en **fonction** (`{ id, describedBy }`) plutôt
 * que de cloner un élément : le contrôle ne peut pas obtenir son `id`
 * autrement, donc l'appariement label/contrôle ne peut pas être oublié. Un
 * `cloneElement` implicite laisserait passer un enfant qui ignore les props
 * injectées, sans le moindre signal.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldSet } from './Field';

describe('Field', () => {
  it('associe son label au contrôle : le champ est trouvable par son nom', () => {
    render(
      <Field label="Nom d'affichage">{({ id }) => <input id={id} defaultValue="Manu" />}</Field>,
    );

    expect(screen.getByRole('textbox', { name: "Nom d'affichage" })).toHaveValue('Manu');
  });

  it("n'englobe jamais le contrôle dans le <label>", () => {
    // Un <label> englobant ne s'associe qu'à son PREMIER contrôle — c'est la
    // cause racine des bugs multi-contrôles de la Phase 2. La primitive doit
    // rendre ce cas structurellement impossible.
    const { container } = render(
      <Field label="Email">{({ id }) => <input id={id} type="email" />}</Field>,
    );

    const label = container.querySelector('label');
    expect(label).not.toBeNull();
    expect(label?.querySelector('input')).toBeNull();
  });

  it('génère des id distincts pour deux instances portant le même label', () => {
    // Garantie qui règle les collisions d'id de GroupMembersPanel (Phase 3) :
    // deux panels montés simultanément ne doivent pas partager d'id.
    render(
      <>
        <Field label="Cible du transfert">{({ id }) => <input id={id} />}</Field>
        <Field label="Cible du transfert">{({ id }) => <input id={id} />}</Field>
      </>,
    );

    const [first, second] = screen.getAllByRole('textbox', { name: 'Cible du transfert' });
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  it('relie hint et error au contrôle via aria-describedby', () => {
    render(
      <Field
        label="Confirme en saisissant ton adresse email"
        hint="manu@example.com"
        error="Ne correspond pas."
      >
        {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
      </Field>,
    );

    const input = screen.getByRole('textbox', {
      name: 'Confirme en saisissant ton adresse email',
    });
    // Les deux textes doivent être atteignables depuis le contrôle : le hint
    // porte la donnée attendue, l'error dit pourquoi la saisie est refusée.
    // Perdre l'un des deux rend la modale de suppression de compte
    // incompréhensible au lecteur d'écran.
    expect(input).toHaveAccessibleDescription('manu@example.com Ne correspond pas.');
  });

  it('ne pose pas aria-describedby quand il n’y a ni hint ni error', () => {
    render(
      <Field label="Email">
        {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} type="email" />}
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute('aria-describedby');
  });
});

describe('FieldSet', () => {
  it('nomme chaque contrôle d’une liste répétée, pas seulement le premier', () => {
    // Le cas que <Field> seul ne peut pas couvrir : un <label> unique ne
    // s'associe qu'à un contrôle. Ici les 3 options doivent être trouvables
    // individuellement.
    render(
      <FieldSet legend="Options (3/10)">
        {['Option 1', 'Option 2', 'Option 3'].map((name) => (
          <Field key={name} label={name}>
            {({ id }) => <input id={id} />}
          </Field>
        ))}
      </FieldSet>,
    );

    expect(screen.getByRole('textbox', { name: 'Option 1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Option 2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Option 3' })).toBeInTheDocument();
  });

  it('expose sa légende comme nom accessible du groupe', () => {
    render(
      <FieldSet legend="Participants">
        <Field label="Manu">{({ id }) => <input id={id} />}</Field>
      </FieldSet>,
    );

    expect(screen.getByRole('group', { name: 'Participants' })).toBeInTheDocument();
  });
});
