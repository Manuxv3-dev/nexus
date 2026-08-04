import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { useKillerFeaturesWs } from '@/lib/useKillerFeaturesWs';
import { useIsMobile } from '@/lib/useMedia';
import { usePushNavigate } from '@/lib/usePushNavigate';
import { AppShell } from '@/screens/app/AppShell';
import { MobileShell } from '@/screens/app/MobileShell';
import { TitleBar } from '@/screens/app/TitleBar';
import { ForgotPasswordScreen } from '@/screens/auth/ForgotPasswordScreen';
import { InviteRedirectScreen } from '@/screens/auth/InviteRedirectScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { OnboardingScreen } from '@/screens/auth/OnboardingScreen';
import { RegisterScreen } from '@/screens/auth/RegisterScreen';
import { OAuthCallbackScreen } from '@/screens/oauth/OAuthCallbackScreen';
import { PublicEventScreen } from '@/screens/public/PublicEventScreen';
import { PublicExpenseScreen } from '@/screens/public/PublicExpenseScreen';
import { PublicListScreen } from '@/screens/public/PublicListScreen';
import { PublicPollScreen } from '@/screens/public/PublicPollScreen';
import { PublicTodoScreen } from '@/screens/public/PublicTodoScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  // Synchro WS killer features (events / polls / expenses / todos)
  // active sur toutes les routes auth — y compris pages publiques
  // ouvertes par un membre du groupe.
  useKillerFeaturesWs();
  // Deep-link push (MAN-143 Phase 2 Task 4) : écoute les messages
  // `push-navigate` du service worker (clic sur une notif alors qu'une
  // fenêtre est déjà ouverte). Monté ici (pas dans AppShell) pour rester
  // actif même hors `/app` (ex : user sur /settings au moment du clic).
  usePushNavigate();
  // Window controls Tauri (cf. ADR-026 borderless) — boutons floating
  // intégrés DANS la window via overlay, plus une drag region invisible
  // en haut. En mode navigateur web pur, le composant ne rend rien.
  // Le contenu reste full-height (TitleBar n'occupe pas de place dans le flow).
  return (
    <>
      <TitleBar />
      <Outlet />
    </>
  );
}

/**
 * Le build `@nexus/web` (servi sur app.nexusapp.chat et embarqué dans
 * Tauri) ne sert PAS la landing marketing — celle-ci est un build
 * dédié `@nexus/landing` servi par Caddy sur l'apex `nexusapp.chat`.
 *
 * Donc sur `/`, on redirige toujours vers `/app` (session active) ou
 * `/login` (session absente), peu importe Tauri vs navigateur.
 */
function IndexComponent() {
  const navigate = useNavigate();
  const { user, initializing } = useAuth();

  useEffect(() => {
    if (initializing) return;
    void navigate({ to: user ? '/app' : '/login', replace: true });
  }, [user, initializing, navigate]);

  // Spinner pendant qu'on attend la décision auth — évite le flash de
  // contenu vide. Background via CSS var pour respecter le thème
  // (light/dark, fixé par le ThemeProvider parent).
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--nx-bg)',
        color: 'var(--nx-fg-muted)',
        fontSize: 14,
      }}
    >
      <span style={{ animation: 'spinSlow 1s linear infinite' }}>⟳</span>
    </div>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginScreen,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterScreen,
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordScreen,
});
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingScreen,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$slug',
  component: InviteRedirectScreen,
});

function ResponsiveAppShell() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShell /> : <AppShell />;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: ResponsiveAppShell,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsScreen,
});

const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Une seule route paramétrée pour tous les providers (discord, whatsapp,
  // messenger). La page lit elle-même `?provider=...&sessionId=...&groupId=...`.
  path: '/oauth/callback',
  component: OAuthCallbackScreen,
});

const publicEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e/$slug',
  component: PublicEventScreen,
});
const publicPollRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: PublicPollScreen,
});
const publicExpenseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/d/$slug',
  component: PublicExpenseScreen,
});
const publicTodoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$slug',
  component: PublicTodoScreen,
});
const publicListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/l/$slug',
  component: PublicListScreen,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotRoute,
  onboardingRoute,
  inviteRoute,
  appRoute,
  settingsRoute,
  oauthCallbackRoute,
  publicEventRoute,
  publicPollRoute,
  publicExpenseRoute,
  publicTodoRoute,
  publicListRoute,
]);
