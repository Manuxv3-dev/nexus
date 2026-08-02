/**
 * FeatureShell — MAN-112 Task 1 : animation d'entrée mutualisée.
 *
 * `FeatureShell` est le point de montage commun aux 4 dashboards orga
 * (Events/Polls/Expenses/Todos, cf. EventsDashboard.tsx etc.) : porter
 * l'animation d'entrée ici évite de la dupliquer x4.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FeatureShell } from './FeatureShell';

describe('FeatureShell', () => {
  it("anime son entrée avec tailwindcss-animate (fade-in) à l'ouverture d'un panel orga", () => {
    const { container } = render(
      <FeatureShell iconName="calendarBlank" iconColor="#fff" iconBg="#000" title="Événements">
        <div>contenu du dashboard</div>
      </FeatureShell>,
    );

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root).toHaveClass('animate-in');
    expect(root).toHaveClass('fade-in');
  });

  it('reste quasi instantanée via prefers-reduced-motion (héritée, pas de classe !important qui la court-circuiterait)', () => {
    // Cf. Button.test.tsx (MAN-110 Task 4) : la réduction de mouvement est
    // gérée globalement par global.css (transition/animation-duration forcés
    // à 0.01ms), pas testable directement en jsdom. On verrouille ici
    // uniquement l'absence de modifier `!` qui casserait cette règle globale.
    const { container } = render(
      <FeatureShell iconName="calendarBlank" iconColor="#fff" iconBg="#000" title="Événements">
        <div>contenu</div>
      </FeatureShell>,
    );
    const root = container.firstElementChild;
    const classes = (root?.className ?? '').split(/\s+/);
    const animRelated = classes.filter((c) => /^!?(animate|fade|slide|duration)/.test(c));
    expect(animRelated.length).toBeGreaterThan(0);
    expect(animRelated.every((c) => !c.startsWith('!'))).toBe(true);
  });
});
