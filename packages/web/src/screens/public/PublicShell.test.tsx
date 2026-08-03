/**
 * PublicShell — fond aligné landing (MAN-127).
 */
import type * as ReactRouterModule from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { PublicShell } from './PublicShell';

describe('PublicShell', () => {
  describe('fond aligné landing (MAN-127)', () => {
    it('le conteneur racine porte la classe nx-bg-grid', () => {
      const { container } = render(
        <PublicShell>
          <div>contenu</div>
        </PublicShell>,
      );
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\bnx-bg-grid\b/);
    });
  });
});
