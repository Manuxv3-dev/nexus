import { createContext, useContext, type ReactNode } from 'react';

import type { PlatformCapabilities } from '@nexus/platform';

const PlatformContext = createContext<PlatformCapabilities | null>(null);

export function PlatformProvider({
  impl,
  children,
}: {
  impl: PlatformCapabilities;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={impl}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformCapabilities {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error('usePlatform doit être utilisé sous <PlatformProvider>');
  }
  return ctx;
}
