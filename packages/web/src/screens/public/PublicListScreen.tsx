/**
 * Page publique `/l/:slug` — alias de la page Todo (cf. ADR-010 :
 * `/t/:slug` pour les todos d'événement, `/l/:slug` pour les listes
 * partagées). Backend identique, juste OG meta type différent.
 */
import { useParams } from '@tanstack/react-router';

import { PublicTodoBody } from './PublicTodoBody';

export function PublicListScreen() {
  const { slug } = useParams({ from: '/l/$slug' });
  return <PublicTodoBody slug={slug} kind="list" />;
}
