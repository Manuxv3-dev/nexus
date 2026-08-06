/**
 * CreateGroupForm — formulaire de création de groupe partagé (MAN-200).
 *
 * Extrait de deux implémentations quasi identiques : le popover flottant du
 * bouton "+" de la sidebar (`NewGroupButton`, `screens/app/AppShell.tsx`) et
 * le mini-formulaire inline de Settings > Groupes (`CreateGroupButton`,
 * `screens/settings/GroupsSection.tsx`). Chaque appelant garde son propre
 * bouton déclencheur et son propre habillage de positionnement (popover
 * flottant vs flux inline) — ce composant ne monte que le `<form>` (input,
 * erreur inline, boutons Annuler/Créer) et la logique associée
 * (`useCreateGroup`, gestion clavier, clic extérieur optionnel).
 *
 * Le composant n'est monté par l'appelant que lorsqu'il doit être visible
 * (`{open && <CreateGroupForm ... />}`) : pas d'état `open` interne, le
 * montage/démontage gère naturellement le focus initial et le reset du
 * formulaire (un remontage repart d'un state vierge).
 *
 * Deux divergences comportementales entre les deux implémentations
 * d'origine ont été tranchées ici en faveur du comportement le plus
 * correct, pas paramétrées comme des différences :
 * - le bouton "Créer" reste toujours cliquable (jamais
 *   `disabled={!name.trim()}`) : l'erreur inline gère le nom vide. L'ancienne
 *   version sidebar désactivait ce bouton tant que le champ était vide, ce
 *   qui rendait son propre message d'erreur quasiment inatteignable.
 * - le bouton "Annuler" est désactivé pendant `createGroup.isPending`, pour
 *   éviter une action concurrente pendant la mutation.
 *
 * La fermeture au clic extérieur (`closeOnOutsideClick`) reste, elle, une
 * vraie différence de contexte d'usage, volontairement gardée : utile pour
 * un popover flottant (sidebar) qui doit rendre la main à un clic ailleurs,
 * hors-propos pour un formulaire inline (Settings) qui ne flotte pas
 * au-dessus du reste de la page. Le calcul "clic extérieur" ne se limite pas
 * au `<form>` : la détection porte par défaut sur `boundaryRef` si fourni
 * (typiquement le conteneur englobant le déclencheur ET la popover, cf.
 * `NewGroupButton`), sinon sur le `<form>` seul. C'est le même pattern
 * d'exclusion par ref que `GroupMenu.tsx`/`NotificationsBell.tsx` — pas de
 * `stopPropagation` sur le déclencheur, qui casserait les listeners
 * document-level d'autres panels ouverts en même temps (cf. historique
 * MAN-200).
 */
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui';
import { useCreateGroup, type Group } from '@/lib/queries';
import { NX } from '@/lib/tokens';

/**
 * Copy de l'état vide "aucun groupe" — partagée entre `GroupsSection.tsx`
 * (Settings > Groupes) et `MobileShell.tsx` (état vide mobile, MAN-231) pour
 * éviter la dérive de deux forks du même texte. Seule la mise en page
 * (tailles, largeur max) diverge entre les deux, volontairement : c'est la
 * copie qui doit rester unique, pas l'habillage.
 */
export const GROUPS_EMPTY_STATE_TITLE = "Tu n'appartiens à aucun groupe pour l'instant.";
export const GROUPS_EMPTY_STATE_BODY =
  'Crée ton premier groupe pour organiser événements, sondages, dépenses et todos avec tes amis.';

export interface CreateGroupFormProps {
  /** Ferme le form (annulation, succès, Escape, ou clic extérieur si `closeOnOutsideClick`). */
  onClose: () => void;
  /** `true` pour le CTA plus visible (état vide Settings), `false`/omis pour le point d'entrée compact. */
  prominent?: boolean;
  /**
   * `true` : ferme au clic en dehors du form (usage popover flottante, sidebar).
   * `false`/omis : pas de fermeture au clic extérieur (usage inline, Settings).
   */
  closeOnOutsideClick?: boolean;
  /** Appelé avec le groupe créé après un succès, en plus de `onClose` (déjà appelé). */
  onCreated?: (group: Group) => void;
  /**
   * Élément(s) à exclure du calcul "clic extérieur" en plus du formulaire
   * lui-même — typiquement le conteneur de la popover ET le bouton
   * déclencheur, pour reproduire le comportement de GroupMenu.tsx/
   * NotificationsBell.tsx (permet un re-clic sur le déclencheur sans
   * déclencher une fermeture "extérieure" qui entrerait en conflit avec le
   * toggle du déclencheur).
   */
  boundaryRef?: React.RefObject<HTMLElement | null>;
}

export function CreateGroupForm({
  onClose,
  prominent = false,
  closeOnOutsideClick = false,
  onCreated,
  boundaryRef,
}: CreateGroupFormProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const createGroup = useCreateGroup();

  // Focus auto au montage.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fermeture sur clic extérieur — seulement pour l'usage popover flottant.
  // `boundaryRef`, quand fourni, remplace le `<form>` comme frontière : il
  // couvre typiquement le déclencheur ET la popover englobante côté
  // appelant (cf. `NewGroupButton`), pas juste le formulaire.
  useEffect(() => {
    if (!closeOnOutsideClick) return;
    const onDocClick = (e: MouseEvent) => {
      // Une mutation en cours ne doit pas se faire couper l'herbe sous le
      // pied par une fermeture "extérieure" : le formulaire resterait démonté
      // au retour de la réponse, et un remontage ultérieur repartirait d'un
      // `useCreateGroup()` frais dont `isPending` ignore la requête encore en
      // vol (cf. bouton Annuler, même garde).
      if (createGroup.isPending) return;
      const boundary = boundaryRef?.current ?? formRef.current;
      if (boundary?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [closeOnOutsideClick, onClose, boundaryRef, createGroup.isPending]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Le nom est obligatoire.');
      return;
    }
    setError(null);
    try {
      // `onSuccess` de `useCreateGroup` invalide déjà `['groups']` (cf.
      // `lib/queries.ts`) : le nouveau groupe apparaît via le refetch, pas
      // besoin de patcher le cache ici.
      const group = await createGroup.mutateAsync({ name: trimmed });
      onClose();
      onCreated?.(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur à la création.');
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        // Idem clic extérieur : pas de fermeture pendant une mutation en
        // vol, pour ne pas permettre un second submit au remontage.
        if (e.key === 'Escape' && !createGroup.isPending) onClose();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, width: prominent ? 260 : 220 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="La Bande du 11e"
        aria-label="Nom du groupe"
        disabled={createGroup.isPending}
        style={{
          padding: '8px 10px',
          fontSize: 13,
          borderRadius: NX.radiusSm,
          border: `1px solid ${NX.border}`,
          background: NX.bg,
          color: NX.fg,
          outline: 'none',
        }}
      />
      {error && <div style={{ fontSize: 11, color: NX.error }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: prominent ? 'center' : 'flex-end' }}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={createGroup.isPending}
        >
          Annuler
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={createGroup.isPending}
          disabled={createGroup.isPending}
        >
          Créer
        </Button>
      </div>
    </form>
  );
}
