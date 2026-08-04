/**
 * Test d'acceptation bout-en-bout du deep-link push (MAN-143 Phase 2, Task 5
 * — sous-ticket MAN-24). Preuve que la tranche tient : depuis un `kind` de
 * notification côté serveur jusqu'à l'URL de deep-link finale consommée par
 * `AppShell` côté web.
 *
 * Ce fichier ne re-teste PAS chaque bout isolément — c'est déjà couvert par
 * `repo.test.ts` (payload push, mapping kind → pane, ce package) et par
 * `pushDeepLink.test.ts` / `AppShell.pushDeepLink.test.tsx` (côté
 * `@nexus/web`). Il relie les deux bouts du pipe :
 *
 *   kind (backend) --[buildPushPayload]--> payload.data --[buildDeepLinkUrl]--> URL /app?...
 *
 * Import réel vs contrat documenté
 * ---------------------------------
 * `buildPushPayload` est importée RÉELLEMENT depuis `./repo.js` (exportée
 * pour ce test, cf. son commentaire — pure fonction, aucun changement de
 * comportement). Elle appelle en interne le vrai `notificationKindToPane`
 * (@nexus/shared) : la moitié « kind → payload.data » du pipe est donc
 * exercée avec du vrai code de production, pas une reconstruction.
 *
 * `@nexus/backend` n'a pas de dépendance vers `@nexus/web` (et
 * inversement — cf. leurs `package.json` respectifs) : les deux packages
 * sont volontairement découplés, aucun n'est un devDependency de l'autre.
 * `buildDeepLinkUrl` (packages/web/src/lib/pushDeepLink.ts) ne peut donc pas
 * être importée réellement depuis ce test. On reproduit ici sa construction
 * (une simple sérialisation de `data` en query params sur `/app`) — même
 * choix déjà assumé ailleurs dans cette même fonctionnalité : le service
 * worker (`public/sw-push.js`, fichier statique sans bundler) duplique
 * exactement la même logique en JS vanilla pour le cas « aucune fenêtre
 * ouverte », avec la même justification documentée dans le docstring de
 * `pushDeepLink.ts` : le risque de divergence est jugé faible car cette
 * logique se limite à une construction de query string. Si `buildDeepLinkUrl`
 * change de comportement, `pushDeepLink.test.ts` le détecte côté web ; ce
 * test-ci documente le contrat que le backend doit respecter en retour.
 */
import { describe, expect, it, vi } from 'vitest';

// `repo.ts` importe `../../core/logger.js`, qui appelle `loadEnv()` au niveau
// module (`buildOptions()`, cf. logger.ts) — ça casse l'import sans env de
// test complet, alors même que `buildPushPayload` (pure fonction) n'utilise
// ni logger ni DB. Mêmes mocks minimalistes que `repo.test.ts` pour lever ce
// seul blocage, sans dupliquer sa couverture (aucun mock de `web-push` ou de
// `db/client.js` ici : ce test n'appelle jamais `sendPushToUser(s)`).
vi.mock('../../core/env.js', () => ({
  loadEnv: (): Record<string, string> => ({
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
  }),
}));

vi.mock('../../core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { buildPushPayload, type PushTarget } from './repo.js';

/**
 * Reproduction volontaire de `buildDeepLinkUrl` (packages/web/src/lib/pushDeepLink.ts).
 * Voir le commentaire d'en-tête du fichier : contrat documenté, pas un
 * import réel (aucune dépendance cross-package backend ↔ web dans ce repo).
 */
function buildDeepLinkUrlContract(data: {
  groupId: string | null;
  pane: string;
  sourceId: string | null;
}): string {
  if (data.pane === 'home' || !data.groupId) return '/app';

  const search: Record<string, string> = { groupId: data.groupId, pane: data.pane };
  if (data.sourceId) search.sourceId = data.sourceId;
  return `/app?${new URLSearchParams(search).toString()}`;
}

/** Traverse le pipe complet kind (backend) -> data -> URL de deep-link. */
function deepLinkUrlForTarget(target: PushTarget): string {
  const { data } = buildPushPayload(target);
  return buildDeepLinkUrlContract(data);
}

describe('push deep-link — acceptation bout-en-bout (MAN-143 Phase 2)', () => {
  it('push_deep_link_e2e_event_kind', () => {
    const url = deepLinkUrlForTarget({
      userId: 'user-1',
      kind: 'event_rsvp_received',
      groupId: 'group-1',
      sourceId: 'event-1',
    });

    expect(url).toBe('/app?groupId=group-1&pane=event&sourceId=event-1');
  });

  it('push_deep_link_e2e_expense_kind', () => {
    const url = deepLinkUrlForTarget({
      userId: 'user-1',
      kind: 'expense_added',
      groupId: 'group-2',
      sourceId: 'expense-1',
    });

    expect(url).toBe('/app?groupId=group-2&pane=expense&sourceId=expense-1');
  });

  it('push_deep_link_e2e_todo_kind', () => {
    const url = deepLinkUrlForTarget({
      userId: 'user-1',
      kind: 'todo_assigned',
      groupId: 'group-3',
      sourceId: 'todo-item-1',
    });

    expect(url).toBe('/app?groupId=group-3&pane=todo&sourceId=todo-item-1');
  });

  it('push_deep_link_e2e_no_groupId_falls_back_to_bare_app', () => {
    // Notif cross-group (ex : rappel touchant plusieurs groupes) : le
    // backend n'attache pas de groupId, le deep-link doit retomber sur
    // l'app nue plutôt que sur une URL invalide ou partielle.
    const url = deepLinkUrlForTarget({
      userId: 'user-1',
      kind: 'event_reminder',
      groupId: null,
      sourceId: 'event-9',
    });

    expect(url).toBe('/app');
  });
});
