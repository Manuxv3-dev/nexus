/**
 * Tokens de référence accessibles depuis JS (style inline, animations).
 *
 * Le source de vérité reste les CSS variables (cf. styles/tokens.css). Ces
 * constantes sont là pour les usages où Tailwind / CSS vars ne suffisent pas
 * (ex. styles inline animés, palettes pour avatars, etc.).
 *
 * Palette : Neon Dusk dark **pastels** (raffinement J5b — cf. ADR-020).
 * On a baissé la saturation des sémantiques (success/warning/error/info) et
 * du accent pour adoucir l'UI dashboards. La `primary` reste relativement
 * identifiable pour que les CTA "Nouveau X" gardent du punch.
 */

export const NX = {
  bg: 'hsl(240 50% 4%)',
  surface: 'hsl(240 29% 6%)',
  elevated: 'hsl(240 22% 10%)',
  raised: 'hsl(240 18% 14%)',
  border: 'rgba(255,255,255,0.07)',
  borderHover: 'rgba(255,255,255,0.14)',

  primary: '#9080f8',
  primaryHover: '#a293ff',
  primaryDeep: '#5b4fd4',
  primaryMuted: 'rgba(144,128,248,0.14)',
  primaryText: '#c4b5fd',
  accent: '#a8d8ff',
  accentMuted: 'rgba(168,216,255,0.12)',

  fg: '#f0eef6',
  fgMuted: 'rgba(255,255,255,0.58)',
  fgDim: 'rgba(255,255,255,0.32)',
  fgGhost: 'rgba(255,255,255,0.16)',

  success: '#7dd3a0',
  successBg: 'rgba(125,211,160,0.12)',
  error: '#fb9999',
  errorBg: 'rgba(251,153,153,0.10)',
  warning: '#f5c977',
  warningBg: 'rgba(245,201,119,0.12)',
  info: '#9fbef6',
  infoBg: 'rgba(159,190,246,0.12)',

  discord: '#8ea0e6',
  discordBg: 'rgba(142,160,230,0.12)',
  whatsapp: '#7ad99b',
  whatsappBg: 'rgba(122,217,155,0.12)',
  messenger: '#7fb6f5',
  messengerBg: 'rgba(127,182,245,0.12)',

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
 * Palette des avatars utilisateurs — choix déterministe par hash.
 * Versions pastels alignées sur la palette dashboards.
 */
export const AVATAR_PALETTE = [
  '#c4b5fd', // lavande
  '#9fbef6', // bleu poudré
  '#7dd3a0', // mint
  '#f5b89a', // pêche
  '#f5c977', // sand
  '#f4a8c0', // rose poudré
  '#a8d8ff', // sky
  '#bcb3ff', // violet pastel
] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  // Après le modulo, l'index est garanti dans [0, length-1]
  return AVATAR_PALETTE[idx]!;
}
