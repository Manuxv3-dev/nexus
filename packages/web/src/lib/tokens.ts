/**
 * Tokens NEXUS — façade JS pointant vers les CSS variables `--nx-*`.
 *
 * Toutes les valeurs colorées sont des strings `var(--nx-...)`. Le browser
 * résoud les vars au paint : un changement de `data-theme` (cf. lib/theme.ts)
 * suffit à repeindre toute l'UI sans re-render React.
 *
 * Source de vérité : packages/web/src/styles/tokens.css
 * Spec : ADR-021 (Design System v2 — true Apple HIG).
 */

export const NX = {
  bg: 'var(--nx-bg)',
  surface: 'var(--nx-surface)',
  elevated: 'var(--nx-elevated)',
  raised: 'var(--nx-raised)',
  border: 'var(--nx-border)',
  borderHover: 'var(--nx-border-hover)',
  borderStrong: 'var(--nx-border-strong)',

  fg: 'var(--nx-fg)',
  fgMuted: 'var(--nx-fg-muted)',
  fgDim: 'var(--nx-fg-dim)',
  fgGhost: 'var(--nx-fg-ghost)',

  primary: 'var(--nx-primary)',
  primaryHover: 'var(--nx-primary-hover)',
  primaryDeep: 'var(--nx-primary-deep)',
  primaryMuted: 'var(--nx-primary-muted)',
  primaryText: 'var(--nx-primary-text)',
  accent: 'var(--nx-accent)',
  accentBg: 'var(--nx-accent-bg)',
  /** @deprecated Alias de `accentBg`. */
  accentMuted: 'var(--nx-accent-muted)',

  success: 'var(--nx-success)',
  successBg: 'var(--nx-success-bg)',
  error: 'var(--nx-error)',
  errorBg: 'var(--nx-error-bg)',
  warning: 'var(--nx-warning)',
  warningBg: 'var(--nx-warning-bg)',
  info: 'var(--nx-info)',
  infoBg: 'var(--nx-info-bg)',

  featEvents: 'var(--nx-feat-events)',
  featEventsBg: 'var(--nx-feat-events-bg)',
  featPolls: 'var(--nx-feat-polls)',
  featPollsBg: 'var(--nx-feat-polls-bg)',
  featExpenses: 'var(--nx-feat-expenses)',
  featExpensesBg: 'var(--nx-feat-expenses-bg)',
  featTodo: 'var(--nx-feat-todo)',
  featTodoBg: 'var(--nx-feat-todo-bg)',
  featChat: 'var(--nx-feat-chat)',
  featChatBg: 'var(--nx-feat-chat-bg)',

  discord: 'var(--nx-discord)',
  discordBg: 'var(--nx-discord-bg)',
  whatsapp: 'var(--nx-whatsapp)',
  whatsappBg: 'var(--nx-whatsapp-bg)',
  messenger: 'var(--nx-messenger)',
  messengerBg: 'var(--nx-messenger-bg)',

  glassBg: 'var(--nx-glass-bg)',
  glassBgStrong: 'var(--nx-glass-bg-strong)',
  glassBorder: 'var(--nx-glass-border)',
  glassBlur: 'var(--nx-glass-blur)',
  glassBlurSm: 'var(--nx-glass-blur-sm)',
  glassShadow: 'var(--nx-glass-shadow)',

  shadowXs: 'var(--nx-shadow-xs)',
  shadowSm: 'var(--nx-shadow-sm)',
  shadowMd: 'var(--nx-shadow-md)',
  shadowLg: 'var(--nx-shadow-lg)',
  shadowGlow: 'var(--nx-shadow-glow)',
  shadowFocus: 'var(--nx-shadow-focus)',

  /** @deprecated Préférer `radiusLg` (12) ou `radiusXl` (16). */
  radius: 14,
  radiusXl: 16,
  radiusLg: 12,
  radiusMd: 10,
  radiusSm: 8,
  radiusXs: 6,
  radiusPill: 9999,

  spaceDashboard: 24,
  spaceDashboardLg: 32,
} as const;

export type ProviderType =
  | 'discord'
  | 'whatsapp'
  | 'messenger'
  | 'telegram'
  | 'instagram'
  | 'slack'
  | 'teams'
  | 'linkedin'
  | 'twitter'
  | 'reddit'
  | 'tiktok'
  | 'snapchat';

/**
 * Couleurs de marque officielles pour chaque provider — utilisées partout
 * où on doit identifier visuellement un provider (sidebar, settings cards,
 * notifications, hero du WebviewProviderPane). Ces 9 nouvelles valeurs
 * arrivent avec ADR-027 (universalisation webview messaging).
 */
export const sourceColor: Record<ProviderType, string> = {
  discord: NX.discord,
  whatsapp: NX.whatsapp,
  messenger: NX.messenger,
  telegram: '#229ED9',
  instagram: '#E4405F',
  slack: '#4A154B',
  teams: '#6264A7',
  linkedin: '#0A66C2',
  twitter: '#1D1D1D',
  reddit: '#FF4500',
  tiktok: '#010101',
  snapchat: '#FFFC00',
};

/** Couleurs de fond (background tinté ~10%) — pour les surfaces comme cards. */
export const sourceBg: Record<ProviderType, string> = {
  discord: NX.discordBg,
  whatsapp: NX.whatsappBg,
  messenger: NX.messengerBg,
  telegram: 'rgba(34,158,217,0.10)',
  instagram: 'rgba(228,64,95,0.10)',
  slack: 'rgba(74,21,75,0.10)',
  teams: 'rgba(98,100,167,0.10)',
  linkedin: 'rgba(10,102,194,0.10)',
  twitter: 'rgba(29,29,29,0.10)',
  reddit: 'rgba(255,69,0,0.10)',
  tiktok: 'rgba(1,1,1,0.10)',
  snapchat: 'rgba(255,252,0,0.16)',
};

export type FeatureKey = 'events' | 'polls' | 'expenses' | 'todo' | 'chat';

export const featureColor: Record<FeatureKey, string> = {
  events: NX.featEvents,
  polls: NX.featPolls,
  expenses: NX.featExpenses,
  todo: NX.featTodo,
  chat: NX.featChat,
};
export const featureBg: Record<FeatureKey, string> = {
  events: NX.featEventsBg,
  polls: NX.featPollsBg,
  expenses: NX.featExpensesBg,
  todo: NX.featTodoBg,
  chat: NX.featChatBg,
};

export const AVATAR_PALETTE = [
  '#c4b5fd',
  '#9fbef6',
  '#7dd3a0',
  '#f5b89a',
  '#f5c977',
  '#f4a8c0',
  '#a8d8ff',
  '#bcb3ff',
] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  // idx est toujours dans les bornes (modulo la longueur) ; le fallback ne
  // sert qu'à satisfaire noUncheckedIndexedAccess.
  return AVATAR_PALETTE[idx] ?? AVATAR_PALETTE[0];
}
