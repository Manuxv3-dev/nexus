import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

// `globals: false` (cf. vitest.config.ts racine) : @testing-library/react ne
// trouve pas d'`afterEach` global pour son auto-cleanup, donc on le fait
// explicitement — sinon le DOM d'un test fuite dans le suivant.
afterEach(() => {
  cleanup();
});

/**
 * `window.matchMedia` n'existe pas dans ce jsdom (vérifié empiriquement :
 * `typeof window.matchMedia` vaut `'undefined'` sans ce stub). `useMedia`/
 * `useIsMobile` (`lib/useMedia.ts`) l'appelle pourtant à CHAQUE render — et
 * depuis MAN-201 (`GlassDialogShell`, utilisé par tous les dialogs "glass"
 * de l'app), cette surface est atteignable depuis n'importe quel composant
 * qui ouvre un dialog. Sans stub par défaut, un test qui monte un tel
 * composant échoue avec `window.matchMedia is not a function` — une erreur
 * sans lien évident avec ce qu'il teste réellement, et une régression que
 * plus rien ne rattache à ce fichier une fois le contexte perdu.
 *
 * Défaut = branche DESKTOP (`matches: false` pour toute query) : c'est le
 * comportement historique de tous les appelants d'avant ce stub, aucun test
 * existant ne doit changer de comportement en silence à cause de lui.
 *
 * Réinstallé à CHAQUE test (`beforeEach`, pas `beforeAll`) pour qu'une
 * réaffectation locale de `window.matchMedia` dans un test ne fuite jamais
 * vers le suivant. Un test qui a besoin de la branche mobile réaffecte
 * `window.matchMedia` (ou mocke `useIsMobile` directement) dans son propre
 * corps de test ou son propre `beforeEach` — l'ordre d'enregistrement des
 * hooks Vitest (celui d'un fichier de test est enregistré APRÈS celui de ce
 * setup global) garantit que cette réaffectation locale s'exécute après
 * celle-ci et gagne donc pour ce test-là.
 */
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  }));
});
