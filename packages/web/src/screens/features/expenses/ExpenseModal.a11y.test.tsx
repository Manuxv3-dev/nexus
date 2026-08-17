/**
 * MAN-245 Phase 2 — nommage accessible des participants d'une dépense.
 *
 * C'est le pire cas du ticket parent, avec **deux défauts empilés** :
 *
 * 1. Des `<label>` **imbriqués** — le helper `Field` local englobait tout dans
 *    un `<label>`, et chaque ligne de participant était elle-même un `<label>`.
 *    HTML invalide.
 * 2. Un `<label>` contenant **deux** contrôles (checkbox de participation +
 *    input de part) n'en nomme que le premier : le nom du participant partait
 *    sur la checkbox et l'input de montant restait **anonyme**.
 *
 * Le second défaut est celui qui compte à l'usage : en mode « Parts
 * personnalisées », un utilisateur de lecteur d'écran tabulait sur une série de
 * champs de montant sans savoir à qui chacun correspondait.
 *
 * Le mock de `@/lib/queries` reprend la forme de `modal-a11y.test.tsx` (mock
 * complet du module, pas `importOriginal` — c'est ce que fait la suite
 * existante pour ces modales), avec `useGroupMembers` surchargé pour fournir de
 * vrais membres.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GROUP_ID } from '../testFixtures';

import { ExpenseModal } from './ExpenseModal';

const MEMBERS = [
  { userId: 'u-manu', displayName: 'Manu' },
  { userId: 'u-lea', displayName: 'Léa' },
];

vi.mock('@/lib/queries', () => ({
  useGroupMembers: vi.fn(() => ({
    data: [
      { userId: 'u-manu', displayName: 'Manu' },
      { userId: 'u-lea', displayName: 'Léa' },
    ],
  })),
  useCreateExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteExpense: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSettleExpenseShare: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

function renderCreate() {
  return render(<ExpenseModal mode="create" groupId={GROUP_ID} onClose={() => undefined} />);
}

describe('ExpenseModal — nommage accessible (MAN-245 Phase 2)', () => {
  it('nomme le groupe de participants', () => {
    renderCreate();

    // `<FieldSet>` expose sa légende comme nom accessible du groupe — ce qui
    // situe la liste sans avoir à nommer chaque contrôle « Participants ».
    // Nom matché en regex : le compteur dépend de l'état initial du formulaire,
    // qui n'est pas le sujet de ce test.
    expect(screen.getByRole('group', { name: /^Participants \(\d+\/2\)$/ })).toBeInTheDocument();
  });

  it('apparie chaque checkbox de participation à son seul libellé', () => {
    renderCreate();

    // Avant : le nom était capté depuis un `<label>` englobant qui contenait
    // aussi l'input de montant. Ici la checkbox est trouvable par le nom du
    // membre, et elle seule.
    for (const m of MEMBERS) {
      expect(screen.getByRole('checkbox', { name: m.displayName })).toBeInTheDocument();
    }
  });

  it('donne à chaque input de part un nom accessible DISTINCT de la checkbox', async () => {
    const user = userEvent.setup();
    renderCreate();

    // Le champ de montant n'apparaît qu'en mode manuel, pour un participant
    // coché — il faut donc reproduire ce parcours pour atteindre le bug.
    // Les participants sont cochés d'entrée (un effet initialise la liste avec
    // tous les membres du groupe dès qu'ils sont chargés) — pas de clic à faire,
    // et vérifié explicitement plutôt que supposé : sans participant coché, le
    // champ de montant n'est pas rendu et l'assertion finale échouerait pour la
    // mauvaise raison.
    expect(screen.getByLabelText('Manu')).toBeChecked();
    // `getByText` et non `getByRole('button', { name })` : pour calculer un nom
    // accessible, Testing Library clone le nœud, et le `cloneNode` de jsdom
    // re-parse le `style` inline — son parseur du raccourci `background` plante
    // sur la valeur de `NX.warningBg` que portent ces deux boutons. Bug jsdom,
    // sans rapport avec l'accessibilité testée ici ; `getByText` évite le
    // chemin de clonage.
    await user.click(screen.getByText('Parts personnalisées'));

    // C'est l'assertion clé : avant le correctif cet input n'avait AUCUN nom
    // accessible. Et son nom doit différer de celui de la checkbox, sinon les
    // deux contrôles deviennent indiscernables — on remplacerait un bug par un
    // autre.
    //
    // `getByLabelText` plutôt que `getByRole(..., { name })` pour la même
    // raison que ci-dessus : après ce re-render, le scan de rôles de Testing
    // Library clone les nœuds et fait planter le parseur de `background` de
    // jsdom. `ByLabelText` résout `aria-label` et `htmlFor` sans cloner, donc
    // vérifie exactement la même chose — le nom accessible — sans emprunter le
    // chemin cassé.
    const share = screen.getByLabelText('Part de Manu');
    expect(share).toHaveAttribute('inputMode', 'decimal');
    // Les deux contrôles de la ligne portent bien des noms distincts.
    expect(screen.getByLabelText('Manu')).toHaveAttribute('type', 'checkbox');
  });

  it('ne contient plus aucun <label> imbriqué', () => {
    const { container } = renderCreate();

    // Assertion structurelle sur du HTML invalide : un `<label>` ne peut pas
    // contenir un autre `<label>`. Le rendu jsdom ne s'en plaint pas, d'où ce
    // test explicite.
    const nested = Array.from(container.querySelectorAll('label')).filter(
      (l) => l.querySelector('label') !== null,
    );
    expect(nested).toHaveLength(0);
  });

  it('nomme les champs simples du formulaire', () => {
    renderCreate();

    // Ces quatre-là passaient déjà par le helper local (correct pour un
    // contrôle unique) ; le test verrouille qu'ils survivent à la migration
    // vers la primitive partagée.
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Montant (EUR)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Payé par' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tags (séparés par virgule)' })).toBeInTheDocument();
  });
});
