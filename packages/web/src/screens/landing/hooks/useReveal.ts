/**
 * Révélation au scroll — cf. README §Interactions & Behavior.
 *
 * IntersectionObserver (threshold .08, rootMargin '0px 0px -6% 0px'),
 * unobserve après révélation. Deux filets de sécurité, jamais un reveal
 * aveugle (un `setTimeout` global qui affiche tout casserait l'effet sur
 * une page de ~5000px) :
 *   1. déjà à l'écran au montage → révèle immédiatement, sans observer ;
 *   2. après 1200ms, si l'observer n'a toujours pas déclenché (Safari
 *      ancien, page restaurée en scroll-position non nulle sans layout
 *      complet, etc.), on ne révèle que si l'élément est *alors* visible.
 */
import { useEffect, useRef, useState } from 'react';

const SAFETY_NET_MS = 1200;

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setInView(true);
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    obs.observe(el);

    const safetyNet = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        setInView(true);
        obs.disconnect();
      }
    }, SAFETY_NET_MS);

    return () => {
      obs.disconnect();
      window.clearTimeout(safetyNet);
    };
  }, []);

  return { ref, inView };
}

/** Délai de cascade pour les grilles de cartes révélées en groupe. */
export function cascadeDelay(index: number): number {
  return (index % 4) * 0.09;
}
