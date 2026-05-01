/**
 * Tokens NEXUS — façade JS pointant vers les CSS variables `--nx-*`.
 *
 * Toutes les valeurs sont des strings `var(--nx-...)`. Le browser résoud les
 * vars **au paint** : un changement de `data-theme` (cf. lib/theme.ts) suffit
 * à repeindre toute l'UI sans re-render React.
 *
 * Les radius restent des numbers (pas de besoin de switcher selon le thème).
 *
 * Source de vérité : packages/web/src/styles/tokens.css
 */

export const NX = {
  bg: 'var(--nx-bg)',
  surface: 'var(--nx-surface)',
  elevated: 'var(--nx-elevated)',
  raised: 'var(--nx-raised)',
  border: 'var(--nx-border)',
  borderHover: 'var(--nx-border-hover)',

  primary: 'var(--nx-primary)',
  primaryHover: 'var(--nx-primary-hover)',
  primaryDeep: 'var(--nx-primary-deep)',
  primaryMuted: 'var(--nx-primary-muted)',
  primaryText: 'var(--nx-primary-text)',
  accent: 'var(--nx-accent)',
  accentMuted: 'var(--nx-accent-muted)',

  fg: 'var(--nx-fg)',
  fgMuted: 'var(--nx-fg-muted)',
  fgDim: 'var(--nx-fg-dim)',
  fgGhost: 'var(--nx-fg-ghost)',

  success: 'var(--nx-success)',
  successBg: 'var(--nx-success-bg)',
  error: 'var(--nx-error)',
  errorBg: 'var(--nx-error-bg)',
  warning: 'var(--nx-warning)',
  warningBg: 'var(--nx-warning-bg)',
  info: 'var(--nx-info)',
  infoBg: 'var(--nx-info-bg)',

  discord: 'var(--nx-discord)',
  discordBg: 'var(--nx-discord-bg)',
  whatsapp: 'var(--nx-whatsapp)',
  whatsappBg: 'var(--nx-whatsapp-bg)',
  messenger: 'var(--nx-messenger)',
  messengerBg: 'var(--nx-messenger-bg)',

  /* Radius — number, indépendant du thème */
  radius: 14,
  radiusSm: 10,
  radiusXs: 6,
  radiusPill: 24,

  /** Spacing standard pour les dashboards (header, content, gaps). */
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

/**
 * Palette des avatars — choix déterministe par hash. Ces valeurs sont
 * volontairement **fixes** (indépendantes du thème) pour que l'avatar
 * d'un même utilisateur garde la même couleur au switch.
 */
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
