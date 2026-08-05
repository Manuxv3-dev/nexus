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
 * au-dessus du reste de la page. Quand `closeOnOutsideClick` est actif, le
 * déclencheur de l'appelant doit exclure son propre mousedown de cette
 * détection (`onMouseDown={(e) => e.stopPropagation()}`), sans quoi un
 * re-clic sur le déclencheur fermerait puis rouvrirait le popover au lieu de
 * simplement le fermer (cf. `NewGroupButton`).
 */
import { useEffect, useRef, useState } from 'react';

import { useCreateGroup, type Group } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { Button } from './Button';

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
}

export function CreateGroupForm({
  onClose,
  prominent = false,
  closeOnOutsideClick = false,
  onCreated,
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
  useEffect(() => {
    if (!closeOnOutsideClick) return;
    const onDocClick = (e: MouseEvent) => {
      if (formRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [closeOnOutsideClick, onClose]);

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
        if (e.key === 'Escape') onClose();
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
