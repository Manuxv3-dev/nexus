/**
 * SettingsScreen — section "À propos" (MAN-133 : build web, MAN-134 :
 * version desktop).
 *
 * On mocke `@tanstack/react-router` (pas de RouterProvider réel nécessaire
 * pour tester l'écran en isolation) et `@/lib/queries` (pas d'appel réseau
 * réel en test). `useAuth` est un store zustand : piloté directement via
 * `setState`, pas besoin de mock de module. `getVersion()` de
 * `@tauri-apps/api/app` est mocké via `vi.hoisted` pour contrôler sa
 * résolution/rejet par test (même principe que le mock de
 * `@tauri-apps/api/window` dans `TitleBar.test.tsx`, mais celui-ci a besoin
 * d'un résultat piloté, pas juste d'une présence/absence).
 *
 * Section "Notifications push" (MAN-142 phase 1, sous-ticket MAN-24) : même
 * principe de mock pour `@/lib/push` (`getPushSubscriptionStatus`,
 * `subscribeToPush`, `unsubscribeFromPush`) — pas d'accès réel à
 * `navigator.serviceWorker` / `PushManager` en environnement jsdom.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterModule from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import type * as OnboardingTourModule from '@/lib/onboardingTour';
import type * as QueriesModule from '@/lib/queries';
import type * as TauriModule from '@/lib/tauri';

const { getVersionMock } = vi.hoisted(() => ({ getVersionMock: vi.fn() }));
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
const { replayOnboardingTourMock } = vi.hoisted(() => ({ replayOnboardingTourMock: vi.fn() }));
const { useMessagingSessionsMock, deleteSessionMutateAsyncMock } = vi.hoisted(() => ({
  useMessagingSessionsMock: vi.fn<() => { data: QueriesModule.MessagingSession[] }>(() => ({
    data: [],
  })),
  deleteSessionMutateAsyncMock: vi.fn().mockResolvedValue(undefined),
}));
// MAN-239 Phase 1 : `checkProviderWebviewDataStatus` mocké (module `@/lib/tauri`,
// tout le reste passe par `importOriginal`) — pilote quels providers ont des
// données locales sans dépendre du runtime Tauri réel. `useDeleteProviderLocalData`
// mocké séparément (comme `useDeleteMessagingSession` ci-dessus) pour contrôler
// `isPending` indépendamment de `mutateAsync`.
const { checkProviderWebviewDataStatusMock } = vi.hoisted(() => ({
  checkProviderWebviewDataStatusMock: vi.fn().mockResolvedValue({}),
}));
const { deleteLocalDataMutateAsyncMock, useDeleteProviderLocalDataMock } = vi.hoisted(() => {
  const deleteLocalDataMutateAsyncMock = vi.fn().mockResolvedValue({ label: 'unused' });
  const useDeleteProviderLocalDataMock = vi.fn(() => ({
    mutateAsync: deleteLocalDataMutateAsyncMock,
    isPending: false,
  }));
  return { deleteLocalDataMutateAsyncMock, useDeleteProviderLocalDataMock };
});
const {
  getPushSubscriptionStatusMock,
  isPushSupportedMock,
  subscribeToPushMock,
  unsubscribeFromPushMock,
  setPushPreviewMock,
  readPushPreviewMock,
} = vi.hoisted(() => ({
  getPushSubscriptionStatusMock: vi.fn(),
  isPushSupportedMock: vi.fn(),
  subscribeToPushMock: vi.fn(),
  unsubscribeFromPushMock: vi.fn(),
  setPushPreviewMock: vi.fn(),
  readPushPreviewMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }));

vi.mock('@/lib/push', () => ({
  getPushSubscriptionStatus: getPushSubscriptionStatusMock,
  isPushSupported: isPushSupportedMock,
  subscribeToPush: subscribeToPushMock,
  unsubscribeFromPush: unsubscribeFromPushMock,
  setPushPreview: setPushPreviewMock,
  readPushPreview: readPushPreviewMock,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/lib/onboardingTour', async (importOriginal) => {
  const actual = await importOriginal<typeof OnboardingTourModule>();
  return { ...actual, replayOnboardingTour: replayOnboardingTourMock };
});

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGroups: () => ({ data: [], isLoading: false }),
    useMessagingSessions: useMessagingSessionsMock,
    useNotificationPrefs: () => ({ data: undefined }),
    useUpdateNotificationPrefs: () => ({ mutate: vi.fn() }),
    useConnectWebviewProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteMessagingSession: () => ({
      mutateAsync: deleteSessionMutateAsyncMock,
      isPending: false,
    }),
    useDeleteProviderLocalData: useDeleteProviderLocalDataMock,
  };
});

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, checkProviderWebviewDataStatus: checkProviderWebviewDataStatusMock };
});

import { SettingsScreen } from './SettingsScreen';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

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

describe('SettingsScreen', () => {
  beforeEach(() => {
    useAuth.setState({ user: TEST_USER, initializing: false });
    getPushSubscriptionStatusMock.mockResolvedValue('not-subscribed');
    isPushSupportedMock.mockReturnValue(true);
    subscribeToPushMock.mockResolvedValue(undefined);
    unsubscribeFromPushMock.mockResolvedValue(undefined);
    setPushPreviewMock.mockResolvedValue(undefined);
    readPushPreviewMock.mockReturnValue(true);
  });

  afterEach(() => {
    useAuth.setState({ user: null, initializing: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    getVersionMock.mockReset();
    getPushSubscriptionStatusMock.mockReset();
    isPushSupportedMock.mockReset();
    subscribeToPushMock.mockReset();
    unsubscribeFromPushMock.mockReset();
    setPushPreviewMock.mockReset();
    readPushPreviewMock.mockReset();
    navigateMock.mockReset();
    replayOnboardingTourMock.mockReset();
    useMessagingSessionsMock.mockReset();
    useMessagingSessionsMock.mockReturnValue({ data: [] });
    deleteSessionMutateAsyncMock.mockReset();
    deleteSessionMutateAsyncMock.mockResolvedValue(undefined);
    checkProviderWebviewDataStatusMock.mockReset();
    checkProviderWebviewDataStatusMock.mockResolvedValue({});
    deleteLocalDataMutateAsyncMock.mockReset();
    deleteLocalDataMutateAsyncMock.mockResolvedValue({ label: 'unused' });
    useDeleteProviderLocalDataMock.mockReset();
    useDeleteProviderLocalDataMock.mockReturnValue({
      mutateAsync: deleteLocalDataMutateAsyncMock,
      isPending: false,
    });
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  describe('sidebar — onglet "Groupes" (MAN-192)', () => {
    it('test_groups_tab_always_visible_regardless_of_role', () => {
      // Pas de garde conditionnelle à retirer : l'onglet est toujours rendu,
      // quel que soit le rôle du viewer dans ses groupes (spec explicite
      // MAN-192, `useGroups` renvoie `[]` ici via le mock du module).
      renderScreen();

      expect(screen.getByRole('button', { name: 'Groupes' })).toBeInTheDocument();
    });
  });

  describe('section "À propos" — build web (MAN-133)', () => {
    it("affiche l'identifiant de build web quand VITE_GIT_SHA est défini", () => {
      vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('sha-a1b2c3d')).toBeInTheDocument();
    });

    it('affiche un texte de repli quand VITE_GIT_SHA est absent (jamais "undefined")', () => {
      vi.stubEnv('VITE_GIT_SHA', undefined);
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.queryByText('undefined')).not.toBeInTheDocument();
      expect(screen.getByText('build inconnu')).toBeInTheDocument();
    });

    it('affiche aussi le texte de repli quand VITE_GIT_SHA est une chaîne vide (mauvaise config CI)', () => {
      vi.stubEnv('VITE_GIT_SHA', '');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('build inconnu')).toBeInTheDocument();
    });
  });

  describe('"Relancer le tutoriel" (MAN-217 Phase 1 / MAN-220 Task 4)', () => {
    // Vit désormais dans Profil (section "Aide", MAN-220 revue de code — plus
    // découvrable que l'ancien emplacement Sécurité → À propos), qui est la
    // section affichée par défaut : pas de clic d'onglet préalable ici.
    it('relance le tutoriel (replayOnboardingTour) puis renvoie vers /app', async () => {
      replayOnboardingTourMock.mockResolvedValue(undefined);
      renderScreen();

      fireEvent.click(screen.getByText('Relancer le tutoriel'));

      await waitFor(() => expect(replayOnboardingTourMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
    });

    it('affiche un message d’erreur si le replay échoue, sans naviguer', async () => {
      replayOnboardingTourMock.mockRejectedValue(new Error('network down'));
      renderScreen();

      fireEvent.click(screen.getByText('Relancer le tutoriel'));

      expect(
        await screen.findByText('Impossible de relancer le tutoriel. Réessaie.'),
      ).toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalledWith({ to: '/app' });
    });

    it('sort de "Redémarrage…" même si le replay réussit mais que la navigation ne démonte rien (MAN-220 revue de code)', async () => {
      // Régression : `setBusy(false)` ne doit pas dépendre uniquement du
      // `catch` — sinon un succès dont `navigate()` serait un no-op (déjà
      // sur `/app`) laisserait la row bloquée sur "Redémarrage…" pour de bon.
      replayOnboardingTourMock.mockResolvedValue(undefined);
      renderScreen();

      fireEvent.click(screen.getByText('Relancer le tutoriel'));

      expect(await screen.findByText('Redémarrage…')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByText('Revoir les étapes de découverte de nexus')).toBeInTheDocument(),
      );
    });
  });

  describe('section "À propos" — version desktop (MAN-134)', () => {
    it("n'appelle pas getVersion() (API desktop) quand l'app ne tourne pas dans Tauri", () => {
      vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(getVersionMock).not.toHaveBeenCalled();
    });

    it(
      "affiche exactement la valeur résolue par getVersion() (pas l'identifiant de build " +
        "web) quand l'API Tauri est disponible — valeur volontairement improbable pour " +
        "prouver qu'elle vient bien de l'API mockée, pas d'une coïncidence avec la vraie " +
        'version du repo',
      async () => {
        (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        getVersionMock.mockResolvedValue('9.9.9-from-tauri');
        vi.stubEnv('VITE_GIT_SHA', 'sha-a1b2c3d');
        renderScreen();

        fireEvent.click(screen.getByText('Sécurité'));

        expect(await screen.findByText('9.9.9-from-tauri')).toBeInTheDocument();
        expect(screen.queryByText('sha-a1b2c3d')).not.toBeInTheDocument();
        expect(getVersionMock).toHaveBeenCalledTimes(1);
      },
    );

    it('affiche un état de chargement tant que getVersion() est en attente', async () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      let resolveVersion!: (v: string) => void;
      getVersionMock.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveVersion = resolve;
        }),
      );
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(screen.getByText('…')).toBeInTheDocument();

      resolveVersion('0.2.1');
      expect(await screen.findByText('0.2.1')).toBeInTheDocument();
    });

    it('affiche un repli propre quand getVersion() échoue (API Tauri indisponible)', async () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      getVersionMock.mockRejectedValue(new Error('API Tauri indisponible'));
      renderScreen();

      fireEvent.click(screen.getByText('Sécurité'));

      expect(await screen.findByText('version indisponible')).toBeInTheDocument();
    });
  });

  describe('section "Notifications" — toggle push (MAN-142)', () => {
    function goToNotifications() {
      fireEvent.click(screen.getByText('Notifications'));
    }

    it('reflète un abonnement existant au montage (toggle ON)', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('appelle subscribeToPush() quand on active le toggle (OFF → ON)', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('not-subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(toggle);

      await waitFor(() => expect(subscribeToPushMock).toHaveBeenCalledTimes(1));
      expect(unsubscribeFromPushMock).not.toHaveBeenCalled();
    });

    it('appelle unsubscribeFromPush() quand on désactive le toggle (ON → OFF)', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(toggle);

      await waitFor(() => expect(unsubscribeFromPushMock).toHaveBeenCalledTimes(1));
      expect(subscribeToPushMock).not.toHaveBeenCalled();
    });

    it('désactive le toggle et affiche un message si le navigateur ne supporte pas le push', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('unsupported');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toBeDisabled();
      expect(screen.getByText('Non supporté par ce navigateur')).toBeInTheDocument();
      expect(subscribeToPushMock).not.toHaveBeenCalled();
    });
  });

  describe('section "Notifications" — toggle Aperçu (MAN-145 phase 4)', () => {
    function goToNotifications() {
      fireEvent.click(screen.getByText('Notifications'));
    }

    it('test_preview_toggle_calls_setPushPreview', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const previewToggle = await screen.findByRole('switch', { name: 'Aperçu du message' });
      expect(previewToggle).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(previewToggle);

      await waitFor(() => expect(setPushPreviewMock).toHaveBeenCalledTimes(1));
      expect(setPushPreviewMock).toHaveBeenCalledWith(false);
      expect(previewToggle).toHaveAttribute('aria-checked', 'false');
    });

    it('test_preview_toggle_works_even_when_push_toggle_off', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('unsupported');
      renderScreen();

      goToNotifications();

      const pushToggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(pushToggle).toBeDisabled();

      const previewToggle = screen.getByRole('switch', { name: 'Aperçu du message' });
      expect(previewToggle).not.toBeDisabled();

      fireEvent.click(previewToggle);

      await waitFor(() => expect(setPushPreviewMock).toHaveBeenCalledTimes(1));
    });

    it('test_preview_toggle_reflects_persisted_preference_on_mount', async () => {
      // Le réglage vit sur l'appareil (cf. `readPushPreview`) : après un
      // rechargement, le toggle doit repartir de la valeur réelle, pas de ON
      // en dur pendant que le serveur masque le contenu.
      readPushPreviewMock.mockReturnValue(false);
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const previewToggle = await screen.findByRole('switch', { name: 'Aperçu du message' });
      expect(previewToggle).toHaveAttribute('aria-checked', 'false');
    });

    it('test_preview_toggle_reverts_when_update_fails', async () => {
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      setPushPreviewMock.mockRejectedValue(new Error('backend down'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      renderScreen();

      goToNotifications();

      const previewToggle = await screen.findByRole('switch', { name: 'Aperçu du message' });
      fireEvent.click(previewToggle);

      // Le serveur a refusé : le toggle revient à ON, sinon il promettrait un
      // masquage que le prochain push ne respectera pas.
      await waitFor(() => expect(previewToggle).toHaveAttribute('aria-checked', 'true'));
      warn.mockRestore();
    });
  });

  describe('section "Notifications" — permission navigateur refusée (MAN-144)', () => {
    const DENIED_MESSAGE =
      'Bloqué par ton navigateur — autorise les notifications pour ce site dans ses réglages.';

    function goToNotifications() {
      fireEvent.click(screen.getByText('Notifications'));
    }

    it('affiche un toggle OFF/désactivé + un message explicatif quand la permission est refusée', async () => {
      vi.stubGlobal('Notification', { permission: 'denied' });
      // Même si le navigateur pense avoir un abonnement, la permission
      // refusée doit primer : le toggle reste OFF/disabled.
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toBeDisabled();
      expect(screen.getByText(DENIED_MESSAGE)).toBeInTheDocument();
      // Sans permission, aucun abonnement n'est utilisable : on n'enregistre
      // même pas le service worker pour le vérifier.
      expect(getPushSubscriptionStatusMock).not.toHaveBeenCalled();
    });

    it('associe le message au toggle (description accessible, pas juste un texte voisin)', async () => {
      vi.stubGlobal('Notification', { permission: 'denied' });
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAccessibleDescription(DENIED_MESSAGE);
    });

    it("laisse le toggle utilisable quand la permission n'a pas encore été demandée", async () => {
      vi.stubGlobal('Notification', { permission: 'default' });
      getPushSubscriptionStatusMock.mockResolvedValue('not-subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).not.toBeDisabled();
      expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument();

      fireEvent.click(toggle);
      await waitFor(() => expect(subscribeToPushMock).toHaveBeenCalledTimes(1));
    });

    it("reflète l'état d'abonnement normal quand la permission est accordée", async () => {
      vi.stubGlobal('Notification', { permission: 'granted' });
      getPushSubscriptionStatusMock.mockResolvedValue('subscribed');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(toggle).not.toBeDisabled();
    });

    it('relit la permission à chaque montage (pas de cache de la visite précédente)', async () => {
      vi.stubGlobal('Notification', { permission: 'denied' });
      getPushSubscriptionStatusMock.mockResolvedValue('not-subscribed');
      const first = renderScreen();

      fireEvent.click(screen.getByText('Notifications'));

      let toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toBeDisabled();

      first.unmount();

      // La permission a changé entre les deux visites de Settings (accordée
      // depuis les réglages du navigateur) : le second montage doit refléter
      // le nouvel état, pas un cache de la première lecture.
      vi.stubGlobal('Notification', { permission: 'default' });
      renderScreen();

      fireEvent.click(screen.getByText('Notifications'));

      toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).not.toBeDisabled();
    });

    it("affiche l'état bloqué sans remontage quand l'utilisateur refuse au prompt du navigateur", async () => {
      // Chemin le plus courant vers 'denied' : l'utilisateur clique NOTRE
      // toggle, le navigateur demande la permission, il refuse. Sans relecture
      // après coup, la ligne repasserait OFF sans un mot — l'échec silencieux
      // que MAN-144 doit supprimer.
      const notification = { permission: 'default' };
      vi.stubGlobal('Notification', notification);
      getPushSubscriptionStatusMock.mockResolvedValue('not-subscribed');
      subscribeToPushMock.mockImplementation(() => {
        notification.permission = 'denied';
        return Promise.reject(new Error('NotAllowedError'));
      });
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).not.toBeDisabled();

      fireEvent.click(toggle);

      await waitFor(() => expect(screen.getByText(DENIED_MESSAGE)).toBeInTheDocument());
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toBeDisabled();
    });

    it("préfère le message 'non supporté' quand le navigateur refuse ET ne supporte pas le push", async () => {
      // Double négatif : dire « autorise les notifications » à un navigateur
      // qui n'implémente pas Push l'enverrait dans le mur — ça ne débloquerait
      // rien. Le message le plus en amont (support) doit primer.
      vi.stubGlobal('Notification', { permission: 'denied' });
      isPushSupportedMock.mockReturnValue(false);
      getPushSubscriptionStatusMock.mockResolvedValue('unsupported');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toBeDisabled();
      expect(screen.getByText('Non supporté par ce navigateur')).toBeInTheDocument();
      expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument();
    });

    it("traite l'absence totale d'API Notification comme un simple non-support", async () => {
      vi.stubGlobal('Notification', undefined);
      getPushSubscriptionStatusMock.mockResolvedValue('unsupported');
      renderScreen();

      goToNotifications();

      const toggle = await screen.findByRole('switch', { name: 'Notifications push' });
      expect(toggle).toBeDisabled();
      expect(screen.getByText('Non supporté par ce navigateur')).toBeInTheDocument();
      expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe('section "Connexions messageries" — modal de déconnexion (MAN-215)', () => {
    const DISCORD_SESSION = {
      id: '22222222-2222-2222-2222-222222222222',
      userId: TEST_USER.id,
      providerType: 'discord' as const,
      externalId: 'webview:11111111-1111-1111-1111-111111111111',
      displayName: 'Discord',
      status: 'connected' as const,
      statusDetail: null,
      lastConnectedAt: null,
      lastError: null,
      createdBy: TEST_USER.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    function goToConnections() {
      fireEvent.click(screen.getByText('Connexions messageries'));
    }

    it('ne mentionne jamais un bot et décrit fidèlement ce que fait la déconnexion (MAN-215, wording MAN-238)', () => {
      useMessagingSessionsMock.mockReturnValue({ data: [DISCORD_SESSION] });
      renderScreen();

      goToConnections();

      fireEvent.click(screen.getByRole('button', { name: 'Déconnecter' }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Ancien wording faux : ADR-027 a supprimé tout bot/bridge.
      expect(screen.queryByText(/bot/i)).not.toBeInTheDocument();
      // Ancien remplacement, tout aussi faux : la webview est détruite
      // immédiatement côté desktop (onSuccess de useDeleteMessagingSession),
      // elle ne "reste pas active".
      expect(screen.queryByText(/reste active/i)).not.toBeInTheDocument();
      // MAN-238 : le label webview (donc la partition Tauri) est désormais
      // dérivé de userId (identité stable), pas de session.id — reconnecter
      // réutilise la même partition, cookies compris. Le wording n'a plus à
      // promettre une ré-identification qui n'a plus lieu, tout en restant
      // vrai côté web (pas de webview, session déjà gérée par le navigateur),
      // et divulgue explicitement que les données de connexion locales ne
      // sont pas purgées par "Déconnecter" (revue MAN-238 : pas de mot
      // "session" répété avec deux sens différents dans une même modale).
      expect(
        screen.getByText(
          "La session sera supprimée côté nexus et tu ne verras plus les messages Discord dans cette app. Ton compte Discord n'est pas déconnecté de son côté : si tu le reconnectes à nexus, tu retrouveras ta connexion existante, sans nouveau QR code ni login. Tes données de connexion Discord restent stockées sur cet appareil.",
        ),
      ).toBeInTheDocument();
    });

    it('ne duplique pas le nom du provider (pas de label redondant sous la carte, MAN-215 review)', () => {
      useMessagingSessionsMock.mockReturnValue({ data: [DISCORD_SESSION] });
      renderScreen();

      goToConnections();

      // `displayName` du provider connecté vaut déjà "Discord" (nom de la
      // carte) : ConnectionCard ne doit plus le réafficher en dessous.
      expect(screen.getAllByText('Discord')).toHaveLength(1);
    });

    // MAN-241 : `ConfirmDisconnectModal` migré vers `GlassDialogShell` — le
    // titre en gras (`fontWeight: 700`, différent des 500 par défaut du
    // shell) et le CTA rouge à texte blanc (le shell le colore `#1a0606` par
    // défaut) sont préservés via des overrides `style` explicites, vérifiés
    // ci-dessous plutôt que simplement documentés en commentaire (revue).
    it('expose aria-modal et un nom accessible dérivé du titre (MAN-241)', async () => {
      const user = userEvent.setup();
      useMessagingSessionsMock.mockReturnValue({ data: [DISCORD_SESSION] });
      renderScreen();
      goToConnections();
      await user.click(screen.getByRole('button', { name: 'Déconnecter' }));

      const dialog = screen.getByRole('dialog', { name: 'Déconnecter Discord ?' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByText('Déconnecter Discord ?')).toHaveStyle({ fontWeight: '700' });
      expect(within(dialog).getByRole('button', { name: 'Déconnecter' })).toHaveStyle({
        color: '#fff',
        fontWeight: '600',
      });
    });

    it('transmet le userId de la session à la mutation pour recalculer le label webview stable (MAN-238)', async () => {
      const user = userEvent.setup();
      useMessagingSessionsMock.mockReturnValue({ data: [DISCORD_SESSION] });
      renderScreen();
      goToConnections();
      await user.click(screen.getByRole('button', { name: 'Déconnecter' }));

      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }));

      await waitFor(() =>
        expect(deleteSessionMutateAsyncMock).toHaveBeenCalledWith({
          sessionId: DISCORD_SESSION.id,
          providerType: DISCORD_SESSION.providerType,
          userId: DISCORD_SESSION.userId,
        }),
      );
    });

    it('Escape ferme le dialog et rend le focus au bouton "Déconnecter" (MAN-241)', async () => {
      const user = userEvent.setup();
      useMessagingSessionsMock.mockReturnValue({ data: [DISCORD_SESSION] });
      renderScreen();
      goToConnections();
      const trigger = screen.getByRole('button', { name: 'Déconnecter' });
      await user.click(trigger);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(deleteSessionMutateAsyncMock).not.toHaveBeenCalled();
      expect(trigger).toHaveFocus();
    });
  });

  describe('section "Connexions messageries" — suppression des données locales (MAN-239 Phase 1)', () => {
    // Session "déconnectée" (status !== 'connected'/'connecting') : le
    // scope de cette phase se limite explicitement aux providers non
    // connectés — cf. `ConnectionCard.showDeleteLocalData` dans
    // SettingsScreen.tsx.
    const DISCONNECTED_DISCORD_SESSION = {
      id: '33333333-3333-3333-3333-333333333333',
      userId: TEST_USER.id,
      providerType: 'discord' as const,
      externalId: 'webview:11111111-1111-1111-1111-111111111111',
      displayName: 'Discord',
      status: 'disconnected' as const,
      statusDetail: null,
      lastConnectedAt: null,
      lastError: null,
      createdBy: TEST_USER.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Doit rester alignée sur `providerWebviewLabel('discord', TEST_USER.id)`
    // (lib/tauri.ts, non mocké) — recalculée explicitement plutôt
    // qu'importée pour que ce test échoue bruyamment si la convention de
    // label changeait sans que ce fichier soit mis à jour.
    const DISCORD_LABEL = `provider:discord:${TEST_USER.id}`;

    function goToConnections() {
      fireEvent.click(screen.getByText('Connexions messageries'));
    }

    it('test_shows_action_when_data_exists_and_disconnected', async () => {
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      expect(
        await screen.findByRole('button', { name: 'Supprimer les données locales' }),
      ).toBeInTheDocument();
    });

    it('test_hides_action_when_no_local_data', async () => {
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: false });
      renderScreen();
      goToConnections();

      await waitFor(() => expect(checkProviderWebviewDataStatusMock).toHaveBeenCalled());
      expect(
        screen.queryByRole('button', { name: 'Supprimer les données locales' }),
      ).not.toBeInTheDocument();
    });

    it('test_click_opens_confirmation_modal', async () => {
      const user = userEvent.setup();
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      const trigger = await screen.findByRole('button', { name: 'Supprimer les données locales' });
      await user.click(trigger);

      expect(
        screen.getByRole('dialog', { name: 'Supprimer les données locales Discord ?' }),
      ).toBeInTheDocument();
      expect(deleteLocalDataMutateAsyncMock).not.toHaveBeenCalled();
    });

    it('test_confirm_triggers_mutation_and_shows_toast', async () => {
      const user = userEvent.setup();
      deleteLocalDataMutateAsyncMock.mockResolvedValue({ label: DISCORD_LABEL });
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      await user.click(
        await screen.findByRole('button', { name: 'Supprimer les données locales' }),
      );
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

      await waitFor(() =>
        expect(deleteLocalDataMutateAsyncMock).toHaveBeenCalledWith({
          providerType: 'discord',
          userId: TEST_USER.id,
        }),
      );
      expect(await screen.findByText('Données locales Discord supprimées.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('test_cancel_closes_without_mutation', async () => {
      const user = userEvent.setup();
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      await user.click(
        await screen.findByRole('button', { name: 'Supprimer les données locales' }),
      );
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(deleteLocalDataMutateAsyncMock).not.toHaveBeenCalled();
    });

    it('test_error_shows_message_and_allows_retry', async () => {
      const user = userEvent.setup();
      deleteLocalDataMutateAsyncMock.mockRejectedValueOnce(new Error('tauri down'));
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      await user.click(
        await screen.findByRole('button', { name: 'Supprimer les données locales' }),
      );
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

      expect(
        await screen.findByText('Impossible de supprimer les données locales. Réessaie.'),
      ).toBeInTheDocument();
      // Pas de dismiss auto (contrairement au toast de succès) : le message
      // doit encore être là après l'attente ci-dessus, et l'action doit
      // rester disponible pour une deuxième tentative (le statut local
      // "hasLocalData" n'a pas été touché par l'échec).
      const retryButton = await screen.findByRole('button', {
        name: 'Supprimer les données locales',
      });

      await user.click(retryButton);
      const retryDialog = screen.getByRole('dialog');
      await user.click(within(retryDialog).getByRole('button', { name: 'Supprimer' }));

      await waitFor(() => expect(deleteLocalDataMutateAsyncMock).toHaveBeenCalledTimes(2));
    });

    it('test_button_disabled_while_pending', async () => {
      useDeleteProviderLocalDataMock.mockReturnValue({
        mutateAsync: deleteLocalDataMutateAsyncMock,
        isPending: true,
      });
      useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
      checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
      renderScreen();
      goToConnections();

      const button = await screen.findByRole('button', { name: '…' });
      expect(button).toBeDisabled();
    });

    describe('provider encore connecté (MAN-239 Phase 2)', () => {
      // Contrairement à `DISCONNECTED_DISCORD_SESSION` ci-dessus, ce fixture
      // a `status: 'connected'` : le scope de cette phase couvre désormais
      // le cas où l'utilisateur purge les données locales SANS s'être
      // d'abord déconnecté explicitement — `useDeleteProviderLocalData`
      // (Phase 2, `queries.ts`) enchaîne alors déconnexion puis purge.
      const CONNECTED_DISCORD_SESSION = {
        ...DISCONNECTED_DISCORD_SESSION,
        id: '44444444-4444-4444-4444-444444444444',
        status: 'connected' as const,
      };

      it('test_shows_action_for_connected_provider', async () => {
        useMessagingSessionsMock.mockReturnValue({ data: [CONNECTED_DISCORD_SESSION] });
        // `checkProviderWebviewDataStatus` ne renvoie rien pour ce label
        // (délibéré) : un provider connecté a nécessairement une partition
        // webview (c'est elle qui a permis la connexion), l'action ne doit
        // donc pas dépendre de `hasLocalData` dans ce cas précis.
        checkProviderWebviewDataStatusMock.mockResolvedValue({});
        renderScreen();
        goToConnections();

        expect(
          await screen.findByRole('button', { name: 'Supprimer les données locales' }),
        ).toBeInTheDocument();
      });

      it('test_modal_copy_mentions_disconnect_when_connected', async () => {
        const user = userEvent.setup();
        useMessagingSessionsMock.mockReturnValue({ data: [CONNECTED_DISCORD_SESSION] });
        checkProviderWebviewDataStatusMock.mockResolvedValue({});
        renderScreen();
        goToConnections();

        await user.click(
          await screen.findByRole('button', { name: 'Supprimer les données locales' }),
        );

        expect(
          screen.getByText(
            'Tu vas être déconnecté de Discord et tes données de connexion locales seront supprimées sur cet appareil. À ta prochaine connexion, tu devras te réauthentifier complètement.',
          ),
        ).toBeInTheDocument();
      });

      it('test_modal_copy_omits_disconnect_when_already_disconnected', async () => {
        // Régression Phase 1 : le wording du cas déjà déconnecté ne doit pas
        // changer (pas de mention de déconnexion, elle n'a pas lieu).
        const user = userEvent.setup();
        useMessagingSessionsMock.mockReturnValue({ data: [DISCONNECTED_DISCORD_SESSION] });
        checkProviderWebviewDataStatusMock.mockResolvedValue({ [DISCORD_LABEL]: true });
        renderScreen();
        goToConnections();

        await user.click(
          await screen.findByRole('button', { name: 'Supprimer les données locales' }),
        );

        // Scopé au dialog : le badge de statut "Déconnecté" de la carte
        // elle-même (hors modal) contient aussi ce mot, sans rapport avec
        // le wording de la modale testé ici.
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByText(/déconnecté/i)).not.toBeInTheDocument();
        expect(
          within(dialog).getByText(
            'Tes données de connexion locales pour Discord seront supprimées sur cet appareil. À ta prochaine connexion, tu devras te réauthentifier complètement (nouveau QR code ou login).',
          ),
        ).toBeInTheDocument();
      });

      it('test_confirm_triggers_composed_mutation_when_connected', async () => {
        const user = userEvent.setup();
        useMessagingSessionsMock.mockReturnValue({ data: [CONNECTED_DISCORD_SESSION] });
        checkProviderWebviewDataStatusMock.mockResolvedValue({});
        renderScreen();
        goToConnections();

        await user.click(
          await screen.findByRole('button', { name: 'Supprimer les données locales' }),
        );
        const dialog = screen.getByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

        await waitFor(() =>
          expect(deleteLocalDataMutateAsyncMock).toHaveBeenCalledWith({
            providerType: 'discord',
            userId: TEST_USER.id,
            session: { id: CONNECTED_DISCORD_SESSION.id, status: 'connected' },
          }),
        );
      });
    });
  });
});
