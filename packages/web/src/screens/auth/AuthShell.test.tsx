/**
 * AuthShell — fond aligné landing (MAN-127).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthShell } from './AuthShell';

describe('AuthShell', () => {
  describe('fond aligné landing (MAN-127)', () => {
    it('le conteneur racine porte la classe nx-bg-grid', () => {
      const { container } = render(
        <AuthShell>
          <div>contenu</div>
        </AuthShell>,
      );
      const root = container.firstElementChild as HTMLElement;

      expect(root.className).toMatch(/\bnx-bg-grid\b/);
    });
  });
});
