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
