/**
 * WebviewProviderPane — régression MAN-238 sur le site réel du bug : le
 * *create* de la webview Tauri (`TauriWebviewMount`), pas seulement son
 * *destroy* (déjà couvert par `lib/queries.deleteMessagingSession.test.tsx`).
 *
 * Avant le fix, `providerWebviewLabel(provider, session.id)` changeait de
 * label à chaque reconnexion (nouveau `session.id`, `sessions.id` étant un
 * `uuid().defaultRandom()` régénéré après un hard delete) → nouveau
 * `data_directory` Tauri vierge → ré-authentification forcée (QR code,
 * login…). Ce test monte le composant avec deux sessions distinctes (id
 * différent, même `userId` — exactement ce qui se produit lors d'un cycle
 * déconnexion/reconnexion réel) et vérifie que le label transmis à la
 * commande Tauri `create_provider_webview` reste identique.
 */
import { invoke } from '@tauri-apps/api/core';
import type * as TauriCoreModule from '@tauri-apps/api/core';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessagingSession } from '@/lib/queries';

import { WebviewProviderPane } from './WebviewProviderPane';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriCoreModule>();
  return { ...actual, invoke: vi.fn() };
});

const mockedInvoke = vi.mocked(invoke);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeSession(id: string): MessagingSession {
  return {
    id,
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

function findCreateLabel(): unknown {
  const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'create_provider_webview');
  return (call?.[1] as { label?: string } | undefined)?.label;
}

describe('WebviewProviderPane — label webview stable au mount (MAN-238)', () => {
  beforeEach(() => {
    // `isTauri()` (cf. lib/tauri.ts) lit `window.__TAURI_INTERNALS__` : on le
    // force pour monter `TauriWebviewMount` (no-op en navigateur web pur).
    window.__TAURI_INTERNALS__ = {};
    mockedInvoke.mockClear();
    // jsdom n'implémente pas ResizeObserver (vérifié empiriquement : absent
    // du global) — `TauriWebviewMount` en instancie un au mount pour
    // resynchroniser les bounds au resize, sans lien avec ce que ce test
    // vérifie (le label). Stub minimal, local à ce fichier.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it('test_create_provider_webview_label_stable_across_session_recreate', () => {
    const first = render(<WebviewProviderPane session={makeSession('session-A-old')} />);
    const labelForOldSession = findCreateLabel();
    first.unmount();

    mockedInvoke.mockClear();
    const second = render(<WebviewProviderPane session={makeSession('session-B-new')} />);
    const labelForNewSession = findCreateLabel();
    second.unmount();

    // Le label — donc le data_directory Tauri — doit rester identique entre
    // les deux sessions (id différent, même userId) : même partition,
    // cookies préservés, pas de nouvelle ré-authentification.
    expect(labelForOldSession).toBe(`provider:discord:${USER_ID}`);
    expect(labelForOldSession).toBe(labelForNewSession);
  });
});
