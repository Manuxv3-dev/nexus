/**
 * Store du thème (dark / light / auto) — persistance localStorage + sync
 * serveur (cf. J5b #50).
 *
 * Stratégie de cohérence :
 *   1. Au boot avant que `useAuth.init()` ne réponde, on lit le mode depuis
 *      localStorage et on l'applique. Évite le FOUC.
 *   2. Quand `useAuth` charge l'user, on lit `user.themePreference`. Si non
 *      null et différent du mode courant, on l'applique (le serveur prime
 *      sur le cache local).
 *   3. Quand l'utilisateur clique sur un bouton du switcher, on applique
 *      localement (instantané), on update localStorage, et on push un
 *      PATCH /api/v1/auth/me en best-effort (silencieux si erreur réseau,
 *      réessayé au prochain login/init).
 *
 * En mode 'auto', on écoute `prefers-color-scheme` du système et on
 * recalcule automatiquement quand l'utilisateur switche dark/light côté OS.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

import { api } from './api';

export type ThemeMode = 'dark' | 'light' | 'auto';
export type EffectiveTheme = 'dark' | 'light';

const STORAGE_KEY = 'nexus.theme';

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'dark' || v === 'light' || v === 'auto') return v;
  return 'auto';
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
  /**
   * Met à jour le mode en local + persist localStorage + push backend
   * (best-effort). Ignore les erreurs réseau ; le mode est déjà appliqué
   * côté UI et stocké local.
   */
  setMode: (mode: ThemeMode) => void;
  /** Recalcule l'effective theme — utile quand prefers-color-scheme change. */
  refreshEffective: () => void;
  /**
   * Synchronise le mode depuis l'user serveur (appelé par useAuth après
   * `init` / `login`). Si différent du mode courant, on applique sans
   * pousser au backend (c'est déjà la valeur serveur).
   */
  syncFromServer: (themePreference: ThemeMode | null) => void;
}

async function pushToServer(mode: ThemeMode): Promise<void> {
  try {
    await api({
      method: 'PATCH',
      path: '/auth/me',
      body: { themePreference: mode },
    });
  } catch (err) {
    // Best-effort. Le mode est déjà persisté localement, le PATCH se
    // re-tentera au prochain change.
    console.warn('[theme] push backend échoué (ignoré)', err);
  }
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
    void pushToServer(mode);
  },
  refreshEffective: () => {
    const eff = effective(get().mode);
    apply(eff);
    set({ effective: eff });
  },
  syncFromServer: (themePreference) => {
    if (themePreference === null) return; // user n'a jamais choisi → on garde le local
    if (themePreference === get().mode) return; // déjà aligné
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, themePreference);
    }
    const eff = effective(themePreference);
    apply(eff);
    set({ mode: themePreference, effective: eff });
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
