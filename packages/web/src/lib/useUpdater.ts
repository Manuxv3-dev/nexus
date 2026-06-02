/**
 * Hook auto-updater desktop — câble le plugin `tauri-plugin-updater`
 * (cf. ADR-031) au front React.
 *
 * Cycle de vie :
 *   idle → checking → (none | available) → downloading → ready → relaunch
 *                                        ↘ error
 *
 * En mode navigateur web pur (`isTauri() === false`), le hook reste à
 * l'état `idle` et ne fait aucun import lourd : les plugins Tauri sont
 * chargés en `import()` dynamique, donc absents du bundle de la SPA web
 * servie sur app.nexusapp.chat. Seul le binaire desktop les embarque.
 *
 * Le check est déclenché une fois au montage (silencieux) ; l'install est
 * déclenchée manuellement par l'utilisateur via le `UpdaterBanner`
 * ("Installer"). Pas d'auto-install — l'user reste maître du redémarrage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isTauri } from './tauri';

export type UpdaterStatus =
  | 'idle' // pas Tauri, ou check pas encore lancé
  | 'checking' // check() en cours
  | 'none' // à jour, rien à faire
  | 'available' // une MAJ existe, en attente d'action user
  | 'downloading' // download + install en cours
  | 'ready' // installé, en attente du relaunch
  | 'error'; // échec check/download/install

export interface UpdaterDownloadProgress {
  /** Octets téléchargés jusqu'ici. */
  downloaded: number;
  /** Taille totale annoncée par le serveur (0 si inconnue). */
  total: number;
}

export interface UpdaterState {
  status: UpdaterStatus;
  /** Version proposée (ex `0.1.1`). Présent dès `available`. */
  version: string | null;
  /** Notes de version (champ `body` de latest.json). */
  notes: string | null;
  /** Progression du download, présent pendant `downloading`. */
  progress: UpdaterDownloadProgress | null;
  /** Message d'erreur lisible, présent à `error`. */
  error: string | null;
  /** L'user a masqué le banner pour cette session. */
  dismissed: boolean;
}

/**
 * Représentation minimale de l'objet `Update` renvoyé par
 * `@tauri-apps/plugin-updater::check()`. On ne type pas le module en import
 * statique (dynamique seulement), d'où ce type local.
 */
interface TauriUpdate {
  version: string;
  currentVersion: string;
  body?: string;
  downloadAndInstall: (
    onEvent?: (event: TauriUpdateEvent) => void,
  ) => Promise<void>;
}

type TauriUpdateEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

const INITIAL: UpdaterState = {
  status: 'idle',
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: false,
};

export interface UseUpdaterResult extends UpdaterState {
  /** Lance manuellement un re-check (idempotent). */
  check: () => void;
  /** Télécharge + installe la MAJ puis relance l'app. */
  install: () => void;
  /** Masque le banner jusqu'au prochain lancement. */
  dismiss: () => void;
}

export function useUpdater(): UseUpdaterResult {
  const [state, setState] = useState<UpdaterState>(INITIAL);
  // Garde l'objet Update entre le check et l'install sans le re-fetch.
  const updateRef = useRef<TauriUpdate | null>(null);
  const checkedRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (!isTauri()) return;
    setState((s) => ({ ...s, status: 'checking', error: null }));
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = (await check()) as unknown as TauriUpdate | null;
      if (!update) {
        updateRef.current = null;
        setState((s) => ({ ...s, status: 'none' }));
        return;
      }
      updateRef.current = update;
      setState((s) => ({
        ...s,
        status: 'available',
        version: update.version,
        notes: update.body ?? null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Échec de la vérification des mises à jour.',
      }));
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState((s) => ({
      ...s,
      status: 'downloading',
      progress: { downloaded: 0, total: 0 },
      error: null,
    }));
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            setState((s) => ({ ...s, progress: { downloaded: 0, total } }));
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setState((s) => ({ ...s, progress: { downloaded, total } }));
            break;
          case 'Finished':
            setState((s) => ({ ...s, status: 'ready' }));
            break;
        }
      });
      // Relaunch via plugin-process — sur Windows (installMode passive) le
      // setup remplace le binaire, on relance pour charger la nouvelle version.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : "Échec de l'installation de la mise à jour.",
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, dismissed: true }));
  }, []);

  // Check unique au montage (silencieux). Pas de polling V1 : l'user qui
  // garde l'app ouverte longtemps re-checkera au prochain lancement, ce qui
  // couvre le cas d'usage normal. Un polling périodique pourra être ajouté
  // plus tard si besoin (tâche backlog).
  useEffect(() => {
    if (!isTauri() || checkedRef.current) return;
    checkedRef.current = true;
    void runCheck();
  }, [runCheck]);

  return { ...state, check: () => void runCheck(), install: () => void install(), dismiss };
}
