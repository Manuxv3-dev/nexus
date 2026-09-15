/**
 * Zones de clic sous Tauri — invariants de la bande supérieure de fenêtre.
 *
 * Contexte du bug : `TitleBar` posait une drag region invisible en overlay
 * flottant (`position:fixed`, `height:32`, `zIndex:90`, `pointerEvents:'auto'`)
 * par-dessus toute la largeur du haut de fenêtre. Le hit-test s'arrêtait sur
 * l'overlay, donc les contrôles rendus dans cette bande — au premier chef le
 * bouton « Home nexus », recouvert sur 24 de ses 34 px — ne recevaient jamais
 * le clic : la fenêtre se déplaçait à la place.
 *
 * Le handler de Tauri (`src/window/scripts/drag.js`) sait déjà ne pas draguer
 * depuis un élément cliquable — mais il raisonne sur le `composedPath`, donc
 * sur l'**ascendance DOM**. Un overlay est un frère, pas un ancêtre : la
 * protection ne pouvait pas s'appliquer.
 *
 * D'où les deux invariants testés ici :
 *
 *  1. Aucune drag region n'est un calque flottant — toute drag region est un
 *     conteneur réel, donc ancêtre des contrôles qu'elle couvre, ce qui rend
 *     la protection de Tauri opérante.
 *  2. Les contrôles de la bande supérieure descendent bien d'une drag region
 *     (sinon la fenêtre n'est plus déplaçable depuis le haut).
 *
 * Le cluster des boutons fenêtre (`zIndex:200`, 138 px à droite) reste
 * volontairement flottant : c'est lui qui doit rester au-dessus des webviews
 * provider, et il ne porte pas d'attribut de drag.
 *
 * Troisième invariant, depuis le bug « je ne peux plus déplacer la fenêtre »
 * (cf. ticket dédié) : **chaque écran a une prise**. Le mécanisme marchait,
 * mais la couverture était trouée — la vue conversation (webview provider ou
 * état vide, soit l'écran principal), Réglages et l'écran de connexion
 * n'avaient aucune drag region, et la rangée de marque de la blade n'en
 * exposait que son padding, le bouton « Home nexus » s'étirant sur tout le
 * reste. Les cas ci-dessous verrouillent une prise par écran.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as QueriesModule from '@/lib/queries';
import type * as TauriModule from '@/lib/tauri';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: () => '',
  };
});

// `WebviewProviderPane` parle au shell Tauri au mount (création de la webview
// native) : sous jsdom on neutralise ces appels, `isTauri()` reste réel.
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return {
    ...actual,
    createProviderWebview: vi.fn().mockResolvedValue(undefined),
    setProviderWebviewBounds: vi.fn().mockResolvedValue(undefined),
    setProviderWebviewVisible: vi.fn().mockResolvedValue(undefined),
    destroyProviderWebview: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useGroupMembers: () => ({ data: [] }),
    useMessagingSessions: () => ({ data: [] }),
    useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useHomeFeed: () => ({ data: undefined, isLoading: false, isError: false }),
    useNotifications: () => ({ data: undefined, isLoading: false }),
    useMarkNotificationRead: () => ({ mutate: vi.fn() }),
    useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
    useClearAllNotifications: () => ({ mutate: vi.fn(), isPending: false }),
    useEvents: () => ({ data: [], isLoading: false }),
    usePolls: () => ({ data: [], isLoading: false }),
    useExpenses: () => ({ data: [], isLoading: false }),
    useTodoLists: () => ({ data: [], isLoading: false }),
    useActivityFeed: () => ({ data: [], isLoading: false, isError: false }),
  };
});

import { AuthShell } from '../auth/AuthShell';
import { FeatureShell } from '../features/FeatureShell';
import { SectionTitle } from '../settings/primitives';

import { AppShell, EmptyChannel } from './AppShell';
import { AtWindowTopProvider, TITLEBAR_HEIGHT, TitleBar, topBandOffset } from './TitleBar';
import { WebviewProviderPane } from './WebviewProviderPane';

const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'manu@example.com',
  displayName: 'Manu',
  avatarUrl: null,
  themePreference: null,
  landingPreference: 'home' as const,
  onboardingStep: null,
  onboardingCompletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>,
  );
}

/** Une drag region « flottante » recouvre du contenu qu'elle ne contient pas. */
function isFloating(el: HTMLElement): boolean {
  return el.style.position === 'fixed' || el.style.position === 'absolute';
}

describe('drag region Tauri — zones de clic de la bande supérieure', () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
    navigateMock.mockClear();
    useAuth.setState({ user: TEST_USER, initializing: false });
    // jsdom n'a pas de ResizeObserver ; `TauriWebviewMount` en instancie un
    // au mount pour suivre ses bounds — sans rapport avec la drag region.
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
    useAuth.setState({ user: null, initializing: true });
    vi.unstubAllGlobals();
  });

  describe('TitleBar', () => {
    it('ne pose aucune drag region en calque flottant', () => {
      const { container } = render(<TitleBar />);

      const regions = Array.from(
        container.querySelectorAll<HTMLElement>('[data-tauri-drag-region]'),
      );

      // Le bug d'origine : un `position:fixed` couvrant toute la largeur du
      // haut de fenêtre, qui interceptait le hit-test avant les boutons.
      expect(regions.filter(isFloating)).toEqual([]);
    });

    it('conserve les boutons fenêtre, qui eux doivent rester flottants', () => {
      render(<TitleBar />);

      // Le cluster reste au-dessus des webviews provider (z-index ignoré par
      // les guests Chromium) — c'est sa raison d'être, on ne la casse pas.
      for (const name of ['Réduire', 'Agrandir', 'Fermer']) {
        const button = screen.getByRole('button', { name });
        expect(button).toBeInTheDocument();
        expect(button.hasAttribute('data-tauri-drag-region')).toBe(false);
      }
    });
  });

  describe('AppShell', () => {
    it('rend le bouton « Home nexus » cliquable : sa drag region est un ancêtre, pas un calque', () => {
      renderShell();

      const home = screen.getByRole('button', { name: 'Home nexus' });
      const region = home.closest('[data-tauri-drag-region]');

      // Ancêtre ⇒ `isDragRegion` de Tauri remonte le composedPath, croise le
      // <button> avant la drag region, et bloque le drag : le clic arrive.
      expect(region).not.toBeNull();
      expect(region).not.toBe(home);
    });

    it('laisse des pixels à la rangée de marque : le bouton « Home nexus » ne s’étire pas', () => {
      // Une drag region dont l'unique enfant remplit toute la largeur n'a
      // plus un pixel à elle — Tauri bloque le drag depuis le bouton, et il
      // ne restait que le padding. C'est ce qui rendait la blade
      // « indéplaçable » à l'usage.
      renderShell();

      const home = screen.getByRole('button', { name: 'Home nexus' });
      expect(home.style.flexGrow).not.toBe('1');
    });
  });

  describe('vue conversation — l’écran principal, sans header', () => {
    // Sous `AppShell`, la zone main d'une conversation n'a pas de header : la
    // webview provider (Chromium natif, insensible au DOM) commence
    // TITLEBAR_HEIGHT px sous le haut de fenêtre, et l'état vide est un bloc
    // centré. La seule prise possible, ce sont les pixels propres du
    // conteneur — attribut NU : Tauri ne déplace que sur clic direct.
    const SESSION = {
      id: 'sess-1',
      providerType: 'whatsapp' as const,
      status: 'connected' as const,
      label: 'WhatsApp',
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
    };

    it('la monture de webview porte la drag region nue au ras du haut de window', () => {
      const { container } = render(
        <AtWindowTopProvider value>
          <WebviewProviderPane session={SESSION as never} />
        </AtWindowTopProvider>,
      );

      const mount = container.querySelector<HTMLElement>('[data-tauri-webview-mount]');
      expect(mount).not.toBeNull();
      expect(mount?.getAttribute('data-tauri-drag-region')).toBe('');
      // Nue, pas `deep` : la bande exposée au-dessus de la webview est vide
      // par construction, pas besoin d'étendre au sous-arbre.
      expect(mount?.getAttribute('data-tauri-drag-region')).not.toBe('deep');
    });

    it('la monture de webview ne porte rien sous un header de stack (MobileShell)', () => {
      const { container } = render(
        <AtWindowTopProvider value={false}>
          <WebviewProviderPane session={SESSION as never} />
        </AtWindowTopProvider>,
      );

      const mount = container.querySelector<HTMLElement>('[data-tauri-webview-mount]');
      expect(mount?.hasAttribute('data-tauri-drag-region')).toBe(false);
    });

    it('l’état vide porte la drag region nue au ras du haut de window', () => {
      const { container } = render(
        <AtWindowTopProvider value>
          <EmptyChannel hasGroups hasSessions={false} />
        </AtWindowTopProvider>,
      );

      const root = container.firstElementChild;
      expect(root?.getAttribute('data-tauri-drag-region')).toBe('');
    });

    it('l’état vide ne porte rien sous un header de stack (MobileShell)', () => {
      const { container } = render(
        <AtWindowTopProvider value={false}>
          <EmptyChannel hasGroups hasSessions={false} />
        </AtWindowTopProvider>,
      );

      expect(container.firstElementChild?.hasAttribute('data-tauri-drag-region')).toBe(false);
    });
  });

  describe('écrans hors shell : connexion et Réglages', () => {
    it('le fond de l’écran de connexion déplace la fenêtre, pas la carte de formulaire', () => {
      const { container } = render(
        <AuthShell>
          <form aria-label="connexion">
            <input aria-label="Email" />
          </form>
        </AuthShell>,
      );

      const root = container.firstElementChild;
      // Nue : seuls les clics directs sur le fond de grille déplacent — la
      // carte et ses champs sont des descendants, hors de portée.
      expect(root?.getAttribute('data-tauri-drag-region')).toBe('');
      expect(
        screen.getByRole('form', { name: 'connexion' }).closest('[data-tauri-drag-region]'),
      ).toBe(root);
    });

    it('le titre de section des Réglages est une drag region — son action reste cliquable', () => {
      const { container } = render(
        <SectionTitle title="Groupes" action={<button type="button">Créer un groupe</button>} />,
      );

      const header = container.firstElementChild;
      expect(header?.getAttribute('data-tauri-drag-region')).toBe('deep');
      // Le bouton descend de la region : Tauri le laisse recevoir le clic.
      const action = screen.getByRole('button', { name: 'Créer un groupe' });
      expect(action.closest('[data-tauri-drag-region]')).toBe(header);
    });
  });

  describe('headers dont la position dépend du shell (FeatureShell, dashboards Home)', () => {
    // Ces headers sont les premiers éléments de la zone main sous `AppShell`
    // (donc au ras du haut de window), mais sont rendus SOUS le header du stack
    // detail de `MobileShell`. Ils ne peuvent pas le deviner : c'est le shell
    // qui le leur dit via `AtWindowTopProvider`.
    function renderFeatureShell(atWindowTop: boolean) {
      return render(
        <AtWindowTopProvider value={atWindowTop}>
          <FeatureShell iconName="calendarBlank" iconColor="#fff" iconBg="#000" title="Événements">
            <div>contenu</div>
          </FeatureShell>
        </AtWindowTopProvider>,
      );
    }

    it('porte la drag region quand le shell le déclare en haut de window', () => {
      const { container } = renderFeatureShell(true);

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      expect(header?.getAttribute('data-tauri-drag-region')).toBe('deep');
    });

    it('dégage la bande du cluster fenêtre quand il est en haut de window', () => {
      // Son action de droite (« Nouvel événement ») tombe sinon sous les
      // boutons min/max/close.
      const { container } = renderFeatureShell(true);

      const header = container.querySelector('header');
      const padTop = Number.parseInt(header?.style.paddingTop ?? '0', 10);
      expect(padTop).toBeGreaterThanOrEqual(TITLEBAR_HEIGHT);
    });

    it('ne porte PAS la drag region sous un header de stack (cas MobileShell)', () => {
      // Régression à éviter : décoré inconditionnellement, ce header rendrait
      // le milieu de l'écran déplaçable sur fenêtre étroite.
      const { container } = renderFeatureShell(false);

      const header = container.querySelector('header');
      expect(header).not.toBeNull();
      expect(header?.hasAttribute('data-tauri-drag-region')).toBe(false);
    });
  });

  describe('topBandOffset — ancrage des flottants ancrés en haut', () => {
    it('dégage la bande des boutons fenêtre sous Tauri', () => {
      // Le cluster fenêtre occupe les 138 px de droite sur TITLEBAR_HEIGHT de
      // haut, avec un zIndex de 200 : un flottant ancré à droite dans cette
      // bande (toast de rappel) reçoit les clics de min/max/close à sa place.
      expect(topBandOffset(16)).toBeGreaterThanOrEqual(TITLEBAR_HEIGHT);
    });

    it('laisse l’ancrage web intact hors Tauri', () => {
      delete window.__TAURI_INTERNALS__;

      // Aucun cluster fenêtre en navigateur : rien à dégager, l'ancrage de
      // design d'origine doit être rendu tel quel.
      expect(topBandOffset(16)).toBe(16);
    });
  });
});
