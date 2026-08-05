/**
 * CopyLinkButton — bouton "Copier" générique pour un lien (invitation, ID de
 * groupe partageable, etc.), extrait en MAN-198 (Item 1, polish de MAN-193)
 * de deux implémentations quasi identiques :
 *  - `InvitationRow` (`screens/app/GroupInvitationsSection.tsx`) — déjà
 *    corrigée pendant la revue de MAN-193 (`.then(onSuccess, onFailure)` +
 *    nettoyage du timeout au démontage), c'est la version reprise ici telle
 *    quelle.
 *  - `InviteDialog` (`screens/app/GroupMenu.tsx`) — avait le bug inverse :
 *    `setCopied(true)` était appelé inconditionnellement après un
 *    `void navigator.clipboard.writeText(link)`, y compris si l'écriture
 *    presse-papiers rejetait (permission refusée, contexte non sécurisé,
 *    etc.) — l'UI mentait alors "Copié !" sans que la copie ait eu lieu.
 *
 * Échec silencieux volontaire (pas de nouvel état "erreur copie" dédié) :
 * cas mineur, l'utilisateur peut simplement retenter le clic.
 */
import { useEffect, useRef, useState } from 'react';

import { NX } from '@/lib/tokens';

export interface CopyLinkButtonProps {
  /** Lien à copier dans le presse-papiers au clic. */
  link: string;
}

export function CopyLinkButton({ link }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  // Nettoyage au démontage (ex. la ligne d'invitation est révoquée juste
  // après un clic sur "Copier") et avant tout nouveau clic (re-clic rapide) :
  // évite un `setCopied(false)` en retard qui écraserait un état plus récent.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  function handleCopy() {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // échec silencieux acceptable ici : pas de nouvel état "erreur copie"
        // dédié pour ce cas mineur.
      },
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        background: copied ? NX.successBg : 'transparent',
        color: copied ? NX.success : NX.primaryText,
        border: `0.5px solid ${copied ? NX.success : NX.border}`,
        padding: '4px 10px',
        borderRadius: NX.radiusPill,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {/* `aria-live="polite"` : un lecteur d'écran annonce le changement
          "Copier" → "Copié !" une seule fois, sans interrompre l'utilisateur
          (MAN-198 Item 3a). */}
      <span aria-live="polite">{copied ? 'Copié !' : 'Copier'}</span>
    </button>
  );
}
