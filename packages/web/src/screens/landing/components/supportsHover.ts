/**
 * true survol (souris/trackpad), pas un doigt — cf. README §Responsive :
 * "désactiver magnétisme et tilt (pas de survol au tactile)".
 */
export function supportsHover(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}
