/**
 * CopyLinkButton — tests unitaires (MAN-198 Item 1, extraction depuis
 * `InvitationRow`/`InviteDialog`). Couvre le comportement partagé par les
 * deux call sites : succès (`Copier` → `Copié !` → retour après ~2s), échec
 * silencieux (jamais de `Copié !` affiché), et cleanup du timeout au
 * démontage (pas de `setState` après unmount).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyLinkButton } from './CopyLinkButton';

const LINK = 'https://nexusapp.chat/invite/abc123';

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('CopyLinkButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche "Copié !" après une copie réussie, puis revient à "Copier" après ~2s', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyLinkButton link={LINK} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));

    expect(await screen.findByRole('button', { name: 'Copié !' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(LINK);

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument(),
      { timeout: 3000 },
    );
  }, 10000);

  it('n\'affiche jamais "Copié !" quand la copie échoue (échec silencieux)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    mockClipboard(writeText);
    render(<CopyLinkButton link={LINK} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copié !' })).not.toBeInTheDocument();
  });

  it('le libellé porte aria-live="polite" pour annoncer le changement d\'état', () => {
    render(<CopyLinkButton link={LINK} />);

    const label = screen.getByText('Copier');
    expect(label).toHaveAttribute('aria-live', 'polite');
  });

  it('nettoie le timeout au démontage (pas de setState après le unmount)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<CopyLinkButton link={LINK} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));
    expect(await screen.findByRole('button', { name: 'Copié !' })).toBeInTheDocument();

    unmount();

    // Comportement observable et falsifiable : le timeout programmé par
    // `handleCopy` doit être annulé au démontage (sinon `setCopied(false)`
    // s'exécuterait ~2s plus tard sur un composant démonté).
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
