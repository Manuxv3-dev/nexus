/**
 * Store du thème (dark / light / auto) avec persistance localStorage.
 *
 * Le mode est appliqué via `document.documentElement.dataset.theme` ; les
 * tokens CSS (cf. styles/tokens.css) lisent cette propriété pour switcher
 * la palette.
 *
 * En mode 'auto', on écoute `prefers-color-scheme` du système et on
 * recalcule automatiquement quand l'utilisateur switche dark/light côté OS.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'auto';
export type EffectiveTheme = 'dark' | 'light';

const STORAGE_KEY = 'nexus.theme';

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'dark' || v === 'light' || v === 'auto') return v;
  return 'dark';
}

function systemTheme(): EffectiveTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function effective(mode: ThemeMode): EffectiveTheme {
  return mode === 'auto' ? systemTheme() : mode;
}

function apply(eff: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = eff;
}

interface ThemeState {
  mode: ThemeMode;
  effective: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
  /** Recalcule l'effective theme — utile quand prefers-color-scheme change. */
  refreshEffective: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: readStored(),
  effective: effective(readStored()),
  setMode: (mode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
    const eff = effective(mode);
    apply(eff);
    set({ mode, effective: eff });
  },
  refreshEffective: () => {
    const eff = effective(get().mode);
    apply(eff);
    set({ effective: eff });
  },
}));

/**
 * Hook à monter une fois (typiquement dans App / main) :
 *   - applique le thème stocké au mount
 *   - écoute prefers-color-scheme quand mode === 'auto'
 */
export function useApplyTheme() {
  const mode = useTheme((s) => s.mode);
  const refreshEffective = useTheme((s) => s.refreshEffective);

  useEffect(() => {
    refreshEffective();
  }, [mode, refreshEffective]);

  useEffect(() => {
    if (mode !== 'auto') return undefined;
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => refreshEffective();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode, refreshEffective]);
}
