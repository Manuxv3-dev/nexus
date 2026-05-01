import { useEffect, useState } from 'react';

/**
 * Hook minimaliste pour matcher une media query.
 *
 * Le mobile prototype du bundle design utilise un layout en stack (pas en
 * 3-pane). On considère mobile = viewport < 768px, et bascule l'AppShell
 * vers une nav par stack (groupes -> channels -> chat) avec retour.
 */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMedia('(max-width: 767.98px)');
