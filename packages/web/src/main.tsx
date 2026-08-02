import { WebPlatform } from '@nexus/platform-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';

import { PlatformProvider } from '@/lib/platform';
import { useApplyTheme } from '@/lib/theme';
import { routeTree } from '@/router';

import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * Wrapper qui monte les hooks globaux (thème, etc.) avant de rendre le router.
 * Sépare les hooks du rendering top-level pour rester StrictMode-friendly.
 */
function AppRoot() {
  useApplyTheme();
  return (
    <HelmetProvider>
      <PlatformProvider impl={WebPlatform}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </PlatformProvider>
    </HelmetProvider>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root introuvable');

createRoot(rootEl).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
