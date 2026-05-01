/**
 * Tokens de référence accessibles depuis JS (style inline, animations).
 *
 * Le source de vérité reste les CSS variables (cf. styles/tokens.css). Ces
 * constantes sont là pour les usages où Tailwind / CSS vars ne suffisent pas
 * (ex. styles inline animés, palettes pour avatars, etc.).
 */

export const NX = {
  bg: 'hsl(240 50% 4%)',
  surface: 'hsl(240 29% 6%)',
  elevated: 'hsl(240 22% 10%)',
  raised: 'hsl(240 18% 14%)',
  border: 'rgba(255,255,255,0.06)',
  borderHover: 'rgba(255,255,255,0.12)',

  primary: '#7c5cfc',
  primaryHover: '#8d70ff',
  primaryDeep: '#5b3fd4',
  primaryMuted: 'rgba(124,92,252,0.12)',
  primaryText: '#a78bfa',
  accent: '#c084fc',
  accentMuted: 'rgba(192,132,252,0.1)',

  fg: '#f0eef6',
  fgMuted: 'rgba(255,255,255,0.55)',
  fgDim: 'rgba(255,255,255,0.3)',
  fgGhost: 'rgba(255,255,255,0.15)',

  success: '#34d399',
  successBg: 'rgba(52,211,153,0.1)',
  error: '#f87171',
  errorBg: 'rgba(248,113,113,0.08)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.1)',
  info: '#60a5fa',
  infoBg: 'rgba(96,165,250,0.1)',

  discord: '#7289da',
  discordBg: 'rgba(114,137,218,0.12)',
  whatsapp: '#25d366',
  whatsappBg: 'rgba(37,211,102,0.1)',
  messenger: '#0084ff',
  messengerBg: 'rgba(0,132,255,0.1)',

  radius: 14,
  radiusSm: 10,
  radiusXs: 6,
  radiusPill: 24,
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

/** Palette des avatars utilisateurs — choix déterministe par hash. */
export const AVATAR_PALETTE = [
  '#c084fc',
  '#60a5fa',
  '#34d399',
  '#f97356',
  '#fbbf24',
  '#f472b6',
  '#38bdf8',
  '#a78bfa',
] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  // Après le modulo, l'index est garanti dans [0, length-1]
  return AVATAR_PALETTE[idx]!;
}
