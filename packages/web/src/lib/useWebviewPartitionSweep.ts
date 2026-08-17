/**
 * Déclenche, une fois par montage du shell, le balayage des partitions
 * webview orphelines de `app_data_dir()/webviews/` (MAN-239 phase 3).
 *
 * Pourquoi piloter depuis le frontend plutôt qu'une heuristique Rust au
 * `setup()` de l'app : seul le frontend authentifié connaît les sessions
 * encore valides. Côté Rust, un dossier de partition est indistinguable d'un
 * orphelin — c'est la liste renvoyée par `useMessagingSessions()`, pas le
 * filesystem, qui fait autorité.
 *
 * **Le `enabled` est un garde-fou, pas un confort.** `useMessagingSessions()`
 * renvoie `data === undefined` pendant le chargement, et les appelants font
 * `data ?? []` : balayer sur ce `[]` transitoire supprimerait la partition de
 * tous les providers connectés (ré-authentification forcée partout). Ne
 * passer `enabled: true` qu'une fois la query réellement résolue
 * (`isSuccess`), jamais sur un simple « pas en erreur ».
 *
 * Un seul balayage par montage : les refetch/invalidations de
 * `useMessagingSessions()` renvoient un nouveau tableau à chaque fois et ne
 * doivent pas relancer le sweep. Un remontage (déconnexion → reconnexion,
 * changement de compte) en redéclenche un — c'est voulu : les partitions de
 * l'ancien `userId` sont précisément des orphelines à purger.
 *
 * No-op hors runtime Tauri : le wrapper `sweepOrphanedWebviewPartitions`
 * porte déjà la garde `isTauri()`.
 */
import { useEffect, useRef } from 'react';

import {
  providerWebviewLabel,
  sweepOrphanedWebviewPartitions,
  type WebviewProvider,
} from './tauri';

export interface UseWebviewPartitionSweepOptions {
  /** `true` uniquement quand la liste des sessions est réellement résolue — cf. avertissement ci-dessus. */
  enabled: boolean;
  /** Sessions messagerie du user courant : leur partition ne doit pas être supprimée. */
  sessions: readonly { providerType: WebviewProvider; userId: string }[];
}

export function useWebviewPartitionSweep({
  enabled,
  sessions,
}: UseWebviewPartitionSweepOptions): void {
  const sweptRef = useRef(false);

  // Ref plutôt que dépendance d'effet : `sessions` change d'identité à chaque
  // refetch, et l'effet ne doit dépendre que de `enabled` (même besoin que
  // `onTargetRef` dans `usePushDeepLink`).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!enabled || sweptRef.current) return;
    sweptRef.current = true;

    const keepLabels = sessionsRef.current.map((s) =>
      providerWebviewLabel(s.providerType, s.userId),
    );

    void sweepOrphanedWebviewPartitions(keepLabels).catch((err: unknown) => {
      // Le balayage est un nettoyage opportuniste : son échec ne doit jamais
      // remonter à l'utilisateur ni casser le rendu du shell.
      console.warn('[webview-sweep] balayage des partitions orphelines échoué', err);
    });
  }, [enabled]);
}
