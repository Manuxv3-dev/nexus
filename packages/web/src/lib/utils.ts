/**
 * Helpers d'utilitaires partagés.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge des classes Tailwind avec déduplication intelligente :
 * `cn('p-2', 'p-4')` → `'p-4'`. Indispensable pour les composants CVA qui
 * laissent l'utilisateur passer un override via `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formate un total de membres avec pluralisation FR simple :
 * `formatMemberCount(1)` → `'1 membre'`, `formatMemberCount(5)` → `'5 membres'`.
 * Reprend le pattern déjà en place dans `GroupHomeDashboard` — extrait ici
 * pour les autres endroits qui affichent `Group.memberCount` (rail desktop,
 * liste mobile, header de groupe mobile — cf. ticket 8a080863).
 */
export function formatMemberCount(count: number): string {
  return `${count} membre${count > 1 ? 's' : ''}`;
}
