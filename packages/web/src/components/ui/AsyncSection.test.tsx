/**
 * `<AsyncSection>` — garde-fou contre les états vides mensongers (MAN-244).
 *
 * Le défaut corrigé : huit sites affirmaient « il n'y a rien » alors que la
 * requête avait échoué. `data` reste `undefined` en cas d'échec, les appelants
 * font `data ?? []`, et l'UI conclut au vide depuis son ignorance.
 *
 * Le contrat testé ici est donc surtout un contrat de **non-affirmation** : à
 * aucun moment un état d'ignorance ne doit produire un rendu qui affirme le
 * vide.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AsyncSection } from './AsyncSection';

const PENDING = <div>Chargement…</div>;
const ERROR = <div>Impossible de charger.</div>;
const EMPTY = <div>Rien pour le moment.</div>;

describe('AsyncSection', () => {
  it('rend la branche error quand la query a échoué', () => {
    render(
      <AsyncSection
        query={{ isPending: false, isError: true, data: undefined }}
        pending={PENDING}
        error={ERROR}
      >
        {() => <div>contenu</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('Impossible de charger.')).toBeInTheDocument();
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
  });

  it("n'affirme jamais le vide sur un échec, même avec une branche empty fournie", () => {
    // C'est LE bug de MAN-244 : avant, `data ?? []` produisait une liste vide
    // sur échec et l'UI rendait l'état vide. La branche error doit gagner.
    render(
      <AsyncSection
        query={{ isPending: false, isError: true, data: undefined }}
        pending={PENDING}
        error={ERROR}
        empty={EMPTY}
        isEmpty={(items: unknown[]) => items.length === 0}
      >
        {() => <div>contenu</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('Impossible de charger.')).toBeInTheDocument();
    expect(screen.queryByText('Rien pour le moment.')).not.toBeInTheDocument();
  });

  it('rend la branche pending quand la query est désactivée (isPending sans isLoading)', () => {
    // Le piège de MAN-231 : en TanStack Query v5, une query désactivée via
    // `enabled` rapporte `isLoading === false` mais `isPending === true`. Le
    // composant lit `isPending` pour que l'appelant ne puisse pas se tromper —
    // lire `isLoading` afficherait le vide pendant toute la fenêtre où la query
    // n'est pas encore activée.
    render(
      <AsyncSection
        query={{ isPending: true, isError: false, data: undefined }}
        pending={PENDING}
        error={ERROR}
        empty={EMPTY}
        isEmpty={(items: unknown[]) => items.length === 0}
      >
        {() => <div>contenu</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText('Rien pour le moment.')).not.toBeInTheDocument();
  });

  it('distingue le vide réel de l’échec', () => {
    render(
      <AsyncSection
        query={{ isPending: false, isError: false, data: [] as unknown[] }}
        pending={PENDING}
        error={ERROR}
        empty={EMPTY}
        isEmpty={(items: unknown[]) => items.length === 0}
      >
        {() => <div>contenu</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('Rien pour le moment.')).toBeInTheDocument();
    expect(screen.queryByText('Impossible de charger.')).not.toBeInTheDocument();
  });

  it('rend les données via children quand tout va bien', () => {
    render(
      <AsyncSection
        query={{ isPending: false, isError: false, data: ['a', 'b'] }}
        pending={PENDING}
        error={ERROR}
      >
        {(items) => <div>{items.join('+')}</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('a+b')).toBeInTheDocument();
  });

  it('sans branche empty, un tableau vide passe aux children', () => {
    // Les dashboards décident du vide plus bas, dans leur composant de liste :
    // ils ne passent pas `empty` et doivent recevoir le tableau vide.
    render(
      <AsyncSection
        query={{ isPending: false, isError: false, data: [] as string[] }}
        pending={PENDING}
        error={ERROR}
      >
        {(items) => <div>liste de {items.length}</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('liste de 0')).toBeInTheDocument();
  });

  it('rend pending plutôt que le vide quand data manque sans pending ni error', () => {
    // Violation de contrat côté query (ni en cours, ni en échec, mais sans
    // données). Le composant retombe sur `pending`, jamais sur `empty` : on ne
    // déduit pas le vide d'une absence d'information. C'est la règle qui a été
    // enfreinte partout dans MAN-244.
    render(
      <AsyncSection
        query={{ isPending: false, isError: false, data: undefined }}
        pending={PENDING}
        error={ERROR}
        empty={EMPTY}
        isEmpty={(items: unknown[]) => items.length === 0}
      >
        {() => <div>contenu</div>}
      </AsyncSection>,
    );

    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText('Rien pour le moment.')).not.toBeInTheDocument();
  });
});
