/**
 * GroupMenu — tests du menu kebab du groupe (MAN-111 Phase 2 : habillage &
 * entrée du shell/nav).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Group } from '@/lib/queries';

import { GroupMenu } from './GroupMenu';

const TEST_GROUP: Group = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'La Bande du 11e',
  createdBy: '11111111-1111-1111-1111-111111111111',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupMenu group={TEST_GROUP} />
    </QueryClientProvider>,
  );
}

describe('GroupMenu', () => {
  describe('profondeur visuelle (MAN-111 Task 2)', () => {
    it('le déclencheur du menu porte un token d’ombre, au même registre visuel que le reste du shell', () => {
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });

      expect(trigger.style.boxShadow).not.toBe('');
      expect(trigger.style.boxShadow).toContain('var(--nx-shadow');
    });
  });

  describe('comportement du déclencheur (garde-fou de non-régression)', () => {
    it('ouvre le menu au clic, sans régression suite à l’ajout de la profondeur visuelle', async () => {
      const user = userEvent.setup();
      renderMenu();

      const trigger = screen.getByRole('button', { name: 'Options du groupe' });
      await user.click(trigger);

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });
});
