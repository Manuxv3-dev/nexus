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

export type ProviderType = 'discord' | 'whatsapp' | 'messenger';

export const sourceColor: Record<ProviderType, string> = {
  discord: NX.discord,
  whatsapp: NX.whatsapp,
  messenger: NX.messenger,
};
export const sourceBg: Record<ProviderType, string> = {
  discord: NX.discordBg,
  whatsapp: NX.whatsappBg,
  messenger: NX.messengerBg,
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
  return AVATAR_PALETTE[idx]!;
}
