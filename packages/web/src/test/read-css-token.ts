import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lit la valeur d'une custom property dans un bloc de thème de `tokens.css`
 * — cf. MAN-127. Nécessaire car Vitest tourne avec `css: false`
 * (`vitest.config.ts`) : aucune feuille de style n'est chargée dans jsdom,
 * donc `getComputedStyle` ne reflète jamais les vraies valeurs CSS en test.
 * On lit directement le fichier source à la place — pas de risque de
 * dérive avec une copie JS, c'est le fichier réel.
 *
 * Vit dans `src/test/` (pas `src/lib/`) : c'est un utilitaire de test qui
 * importe `node:fs`, pas du code applicatif — le garder hors de `src/lib/`
 * évite qu'il se retrouve embarqué dans un build.
 */
const TOKENS_CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css');

export function readCssToken(theme: 'dark' | 'light', varName: string): string {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf8');

  const selector = theme === 'dark' ? '[data-theme="dark"]' : '[data-theme="light"]';
  const blockStart = css.indexOf(selector);
  if (blockStart === -1) {
    throw new Error(`readCssToken: bloc "${selector}" introuvable dans tokens.css`);
  }
  const braceStart = css.indexOf('{', blockStart);
  const braceEnd = css.indexOf('\n}', braceStart);
  if (braceEnd === -1) {
    throw new Error(`readCssToken: accolade fermante introuvable pour le bloc "${selector}"`);
  }
  const block = css.slice(braceStart, braceEnd);

  const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const varRegex = new RegExp(`--${escapedVarName}:\\s*([^;]+);`);
  const match = varRegex.exec(block);
  if (!match?.[1]) {
    throw new Error(`readCssToken: --${varName} introuvable dans le bloc [data-theme="${theme}"]`);
  }
  return match[1].trim();
}
