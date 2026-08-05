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

  it('nettoie le timeout au démontage sans avertissement React (pas de setState post-unmount)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(<CopyLinkButton link={LINK} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copier' }));
    expect(await screen.findByRole('button', { name: 'Copié !' })).toBeInTheDocument();

    unmount();
    // Si le timeout n'était pas nettoyé, ce délai déclencherait un
    // `setState` sur un composant démonté (avertissement React logué via
    // `console.error`).
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(consoleError).not.toHaveBeenCalled();
  }, 10000);
});
