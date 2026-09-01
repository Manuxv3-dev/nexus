/**
 * MAN-246 phase 5, point 1 — « Ouvrir {provider} » en mode navigateur pur ne
 * doit plus affirmer un succès qu'il n'a pas vérifié.
 *
 * Avant : `window.open(url, '_blank', 'noopener,noreferrer')` dont le retour
 * n'était jamais lu, suivi d'un `window.setTimeout(() => setBusy(false), 600)`
 * dans un `finally`. Le spinner s'éteignait « proprement » que la fenêtre soit
 * ouverte ou bloquée, et un popup bloqué ne produisait aucun signal : rien ne
 * s'ouvrait, rien ne le disait.
 *
 * Sur le fix, un piège que le ticket n'avait pas vu : le standard HTML impose
 * que `window.open` renvoie `null` dès que `noopener` est demandé (et
 * `noreferrer` implique `noopener`). Lire le retour SANS retirer ces features
 * aurait produit un « popup bloqué » permanent — un mensonge pire que celui
 * qu'on corrige. D'où le test `opener` ci-dessous : la protection contre le
 * window.opener hijacking est conservée, mais en annulant `opener` sur la
 * fenêtre retournée plutôt qu'en aveuglant l'appel.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueriesModule from '@/lib/queries';
import type { MessagingSession } from '@/lib/queries';
import { PROVIDER_WEB_URL } from '@/lib/tauri';

import { WebviewProviderPane } from './WebviewProviderPane';

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useDeleteMessagingSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const DISCORD_URL = PROVIDER_WEB_URL.discord;

function makeSession(): MessagingSession {
  return {
    id: 'session-1',
    userId: USER_ID,
    providerType: 'discord',
    externalId: `webview:${USER_ID}`,
    displayName: 'Discord',
    status: 'connected',
    statusDetail: null,
    lastConnectedAt: null,
    lastError: null,
    createdBy: USER_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Fenêtre suffisamment réelle pour que le composant puisse annuler `opener`. */
function fakeWindow(): { opener: unknown } {
  return { opener: {} };
}

function openButton() {
  return screen.getByRole('button', { name: /Ouvrir Discord/ });
}

describe('WebviewProviderPane — « Ouvrir » en navigateur pur (MAN-246 phase 5)', () => {
  beforeEach(() => {
    // `isTauri()` lit `window.__TAURI_INTERNALS__` : absent ⇒ branche web pure
    // (`WebPlaceholder`), qui est la seule concernée par ce fix.
    delete window.__TAURI_INTERNALS__;
  });

  it('rend un état d’échec explicite quand le popup est bloqué', async () => {
    const user = userEvent.setup();
    window.open = vi.fn().mockReturnValue(null);

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/bloqu/i);
  });

  it('offre un lien pour ouvrir le provider manuellement quand le popup est bloqué', async () => {
    const user = userEvent.setup();
    window.open = vi.fn().mockReturnValue(null);

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());

    const link = await screen.findByRole('link', { name: /discord\.com/i });
    expect(link).toHaveAttribute('href', DISCORD_URL);
    // Un `<a target="_blank">` n'est pas soumis au bloqueur de popup : c'est
    // précisément pourquoi le repli est un lien et pas un second bouton.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('n’annonce aucun échec quand la fenêtre s’ouvre vraiment', async () => {
    const user = userEvent.setup();
    window.open = vi.fn().mockReturnValue(fakeWindow());

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ouvre sans `noopener` (sinon le retour est toujours `null`) mais neutralise `opener`', async () => {
    const user = userEvent.setup();
    const opened = fakeWindow();
    const open = vi.fn().mockReturnValue(opened);
    window.open = open;

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0] as [string, string, string | undefined];
    expect(url).toBe(DISCORD_URL);
    expect(target).toBe('_blank');
    expect(features ?? '').not.toContain('noopener');
    expect(features ?? '').not.toContain('noreferrer');
    // La protection perdue côté features est reprise ici.
    expect(opened.opener).toBeNull();
  });

  it('laisse le bouton actionnable au lieu de le figer sur un faux succès', async () => {
    const user = userEvent.setup();
    window.open = vi.fn().mockReturnValue(null);

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());

    // L'ancien `busy` désactivait le bouton 600 ms puis le rendait quoi qu'il
    // arrive : aucune attente réelle ne le justifiait, `window.open` étant
    // synchrone. Il doit rester immédiatement re-cliquable.
    expect(openButton()).toBeEnabled();
  });

  it('efface l’échec dès qu’une ouverture réussit', async () => {
    const user = userEvent.setup();
    const open = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(fakeWindow());
    window.open = open;

    render(<WebviewProviderPane session={makeSession()} />);
    await user.click(openButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(openButton());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
