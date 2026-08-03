/**
 * Calcul de contraste WCAG 2.1 (luminance relative + ratio) — cf. MAN-127.
 *
 * Pas de dépendance externe : la formule est un calcul pur d'une vingtaine
 * de lignes (cf. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).
 * Gère les couleurs semi-transparentes (`rgba(...)`) en les composant sur
 * le fond avant de calculer la luminance — nécessaire ici car plusieurs
 * tokens Nexus (`--nx-fg-muted`, etc.) sont des rgba, pas des hex opaques.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgba {
  const trimmed = input.trim();

  const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  throw new Error(`wcagContrast: format de couleur non supporté: "${input}"`);
}

/** Compose `fg` (potentiellement translucide) sur `bg` (supposé opaque). */
function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const toLinear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Ratio de contraste WCAG entre `background` (opaque) et `foreground`
 * (hex ou rgba — composé sur `background` si translucide) — de 1 (aucun
 * contraste) à 21 (noir/blanc).
 */
export function wcagContrast(background: string, foreground: string): number {
  const bg = parseColor(background);
  const fg = compositeOver(parseColor(foreground), bg);

  const l1 = relativeLuminance(bg);
  const l2 = relativeLuminance(fg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Luminance relative WCAG d'une couleur opaque (hex ou rgba — composée sur
 * `background` si translucide). Exposée séparément de `wcagContrast` car
 * le ratio de contraste seul ne permet pas de vérifier un *ordre* de
 * luminance (ex: fond < surface < élevé) — le ratio est symétrique, un
 * fond bien plus clair passe le même test qu'un fond bien plus sombre.
 */
export function luminanceOf(color: string, background = '#000000'): number {
  const bg = parseColor(background);
  return relativeLuminance(compositeOver(parseColor(color), bg));
}
