/**
 * Tokens de la landing publique (nexusapp.chat) — palette locale, distincte
 * des `--nx-*` de l'app (cf. `@/lib/tokens`).
 *
 * L'app utilise le Space Gray Apple (ADR-021, en exploration libre). La
 * landing a sa propre identité "true black" définie par le handoff design
 * (design_handoff_nexus_landing/README.md) — `theme-color` de
 * `packages/landing/index.html` l'anticipait déjà. Ne pas fusionner avec
 * `--nx-*` : un changement de thème app ne doit pas repeindre la landing,
 * et vice versa.
 */

export const LX = {
  bg: '#0a0a0f',
  surface: '#0f0f13',
  surfaceAlt: '#0b0b0f',
  card: 'rgba(255,255,255,.028)',
  cardHover: 'rgba(255,255,255,.05)',
  border: 'rgba(255,255,255,.08)',
  borderStrong: 'rgba(255,255,255,.2)',
  borderFaint: 'rgba(255,255,255,.06)',

  text: '#ffffff',
  text2: 'rgba(255,255,255,.6)',
  text3: 'rgba(255,255,255,.5)',
  text4: 'rgba(255,255,255,.35)',
  text5: 'rgba(255,255,255,.28)',

  statusOnline: '#5fdc86',

  ease: 'cubic-bezier(.2,.8,.2,1)',

  /**
   * Largeur de conception du handoff (cf. README §Screens/Views). Le
   * prototype est un canvas fixe à 1200px — au-delà, on centre le contenu
   * dans un conteneur `max-width` (cf. README §Responsive, "≥1200px : tel
   * quel, conteneur centré max-width:1200px") plutôt que de laisser les
   * éléments positionnés en absolu (chips du hero) dériver vers les bords
   * d'un viewport plus large.
   */
  maxWidth: 1200,
} as const;

export interface ModuleAccent {
  accent: string;
  text: string;
  bg: string;
  border: string;
}

/** Couleurs des 4 modules d'orga + la marque (violet), cf. README §Design Tokens. */
export const LX_MODULE = {
  events: {
    accent: '#007AFF',
    text: '#7fb4ff',
    bg: 'rgba(0,122,255,.16)',
    border: 'rgba(0,122,255,.2)',
  },
  polls: {
    accent: '#A855F7',
    text: '#d0a5ff',
    bg: 'rgba(168,85,247,.16)',
    border: 'rgba(168,85,247,.2)',
  },
  expenses: {
    accent: '#F59E0B',
    text: '#ffc978',
    bg: 'rgba(245,158,11,.14)',
    border: 'rgba(245,158,11,.2)',
  },
  todos: {
    accent: '#34C759',
    text: '#9ceeb4',
    bg: 'rgba(52,199,89,.14)',
    border: 'rgba(52,199,89,.2)',
  },
  brand: {
    accent: '#5856D6',
    text: '#d6d4ff',
    bg: 'rgba(88,86,214,.16)',
    border: 'rgba(88,86,214,.48)',
  },
} as const satisfies Record<string, ModuleAccent>;

export type LxModuleKey = keyof typeof LX_MODULE;
