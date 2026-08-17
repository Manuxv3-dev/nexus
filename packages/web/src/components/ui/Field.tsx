/**
 * Primitives de nommage accessible des formulaires (MAN-245).
 *
 * Le défaut corrigé ici était structurel, pas ponctuel : 23 des 34 contrôles de
 * `@nexus/web` n'avaient aucun nom accessible, et un helper `Field` local était
 * copié-collé dans quatre modales. Un `placeholder` n'est pas un nom — il
 * disparaît à la saisie, donc un utilisateur de lecteur d'écran qui revient sur
 * un champ rempli n'a plus aucune indication de ce qu'il contient.
 *
 * ## Pourquoi children-as-function
 *
 * `<Field>` passe `{ id, describedBy }` à une fonction plutôt que de cloner un
 * élément enfant. C'est plus verbeux, et c'est le point : le contrôle ne peut
 * obtenir son `id` d'aucune autre façon, donc l'appariement label/contrôle ne
 * peut pas être oublié. Un `cloneElement` implicite accepterait sans broncher un
 * enfant qui ignore les props injectées — exactement le mode de défaillance
 * silencieux qu'on vient de corriger (cf. l'ancien `id ?? rest.name` d'`Input`,
 * qui valait `undefined` sans le moindre signal).
 *
 * ## Pourquoi jamais de <label> englobant
 *
 * Un `<label>` ne s'associe qu'à son **premier** contrôle. Envelopper N
 * contrôles n'en nomme qu'un, et imbriquer des `<label>` est du HTML invalide.
 * Ici le `<label htmlFor>` est toujours un frère du contrôle, jamais son parent
 * — la structure rend le bug impossible plutôt que de compter sur la vigilance.
 * Pour les listes répétées, voir `<FieldSet>`.
 */
import { useId, type ReactNode } from 'react';

import { NX } from '@/lib/tokens';

export interface FieldRenderProps {
  /** À poser sur le contrôle : c'est la cible du `htmlFor` du label. */
  id: string;
  /**
   * À poser en `aria-describedby` sur le contrôle. `undefined` quand il n'y a
   * ni hint ni error — poser un `aria-describedby` vide référencerait un id
   * inexistant.
   */
  describedBy: string | undefined;
}

export interface FieldProps {
  /** Nom accessible du contrôle. Obligatoire : c'est tout l'objet du composant. */
  label: string;
  // `| undefined` explicite : sous `exactOptionalPropertyTypes`, un appelant qui
  // passe `error={state.err}` (où `err` peut être `undefined`) serait refusé
  // sans ça — même contrainte que dans `Input.tsx`.
  hint?: string | undefined;
  error?: string | undefined;
  children: (props: FieldRenderProps) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  // Hint ET error ensemble quand les deux existent — différence assumée avec
  // `Input.tsx`, qui masque le hint dès qu'il y a une erreur. La modale de
  // suppression de compte en dépend : le hint porte l'email attendu (la donnée)
  // et l'erreur dit que la saisie ne correspond pas. Masquer le hint retirerait
  // au lecteur d'écran l'information dont il a besoin pour corriger.
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label htmlFor={id} style={{ fontSize: 12, fontWeight: 500, color: NX.fgMuted }}>
        {label}
      </label>
      {children({ id, describedBy })}
      {hint && (
        <div id={hintId} style={{ fontSize: 11, color: NX.fgDim }}>
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} style={{ fontSize: 11, color: NX.error }}>
          {error}
        </div>
      )}
    </div>
  );
}

export interface FieldSetProps {
  /** Nom accessible du groupe. Rendu en `<legend>`. */
  legend: string;
  children: ReactNode;
}

/**
 * Groupe de contrôles répétés — options de sondage, items de todo, participants
 * d'une dépense.
 *
 * Un `<label>` unique ne peut pas nommer N contrôles : `<FieldSet>` nomme le
 * *groupe* (via `<legend>`, exposé en `role="group"`), et chaque contrôle garde
 * son propre nom via un `<Field>` imbriqué. C'est ce qui distingue « Options »
 * de « Option 2 » — le premier situe le groupe, le second identifie le champ.
 */
export function FieldSet({ legend, children }: FieldSetProps) {
  return (
    <fieldset
      style={{
        border: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0, // `fieldset` a un min-width intrinsèque qui casse les grilles flex
      }}
    >
      <legend style={{ fontSize: 12, fontWeight: 500, color: NX.fgMuted, padding: 0 }}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
