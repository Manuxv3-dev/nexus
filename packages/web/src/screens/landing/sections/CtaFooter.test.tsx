import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CtaFooter, DESKTOP_DOWNLOAD_URL } from './CtaFooter';

describe('CtaFooter', () => {
  it('le CTA "Télécharger l\'app" est un lien direct vers le téléchargement, pas un scroll vers lui-même', () => {
    render(<CtaFooter />);

    const link = screen.getByRole('link', { name: /télécharger l'app/i });
    expect(link).toHaveAttribute('href', DESKTOP_DOWNLOAD_URL);
  });
});
