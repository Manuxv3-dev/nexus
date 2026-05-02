/**
 * Page publique liste de tâches `/t/:slug`.
 *
 * Comportement (cf. J5b #41 + sync) :
 *  - Lecture publique (mise à jour live via WS).
 *  - Check/uncheck : si l'user est membre du groupe, mutation réelle via
 *    `useUpdateTodoItem`. Sinon lecture seule + CTA.
 *
 * Le composant est partagé avec `PublicListScreen` (route `/l/:slug`) — ce
 * dernier réutilise `PublicTodoBody` via le `kind`.
 */
import { useParams } from '@tanstack/react-router';

import { PublicTodoBody } from './PublicTodoBody';

export function PublicTodoScreen() {
  const { slug } = useParams({ from: '/t/$slug' });
  return <PublicTodoBody slug={slug} kind="todo" />;
}
