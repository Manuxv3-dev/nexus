/**
 * Les dates des images OG sont rendues dans le fuseau du produit, pas dans
 * celui du process (cf. ticket 69b79bc0).
 *
 * `toLocaleDateString` / `toLocaleTimeString` sans option `timeZone` formatent
 * dans le fuseau du process Node. En prod le conteneur (`node:22-alpine`,
 * aucun `TZ` posé) tourne en UTC : un événement à 18:00Z — 20 h à Paris —
 * s'affichait « 18:00 » sur l'aperçu partagé dans WhatsApp ou Discord, et un
 * événement à 23:30Z le samedi passait au samedi au lieu du dimanche.
 *
 * Ces cas sont verts sur une machine réglée sur Europe/Paris avec ou sans le
 * correctif — c'est la CI (UTC) qui les rend discriminants, et c'est
 * précisément l'environnement où le bug vivait.
 */
import { describe, expect, it } from 'vitest';

import { eventTemplate, pollTemplate } from './templates.js';

/** Tous les nœuds texte du template, concaténés — ce que l'image dessine. */
function renderedText(template: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(template);
  return out.join('');
}

function event(startsAt: string) {
  return eventTemplate({
    title: 'Barbecue',
    startsAt,
    location: null,
    rsvpCounts: { yes: 1, maybe: 0, no: 0 },
  });
}

describe('templates OG — fuseau horaire du produit', () => {
  it("affiche l'heure de Paris, été comme hiver, quel que soit le fuseau du process", () => {
    // CEST (UTC+2)
    expect(renderedText(event('2026-08-15T18:00:00.000Z'))).toContain('20:00');
    // CET (UTC+1)
    expect(renderedText(event('2026-01-15T18:00:00.000Z'))).toContain('19:00');
  });

  it('bascule de jour avec Paris, pas avec UTC', () => {
    // 23:30Z le samedi 15 août = 01:30 le dimanche 16 à Paris.
    const text = renderedText(event('2026-08-15T23:30:00.000Z'));
    expect(text).toContain('dimanche 16 août');
    expect(text).not.toContain('samedi 15 août');
  });

  it('date de clôture d’un sondage : même fuseau', () => {
    // 23:30Z le 30 juin = 1er juillet à Paris.
    const text = renderedText(
      pollTemplate({
        question: 'On part quand ?',
        multi: false,
        options: [{ label: 'Juin', voteCount: 0 }],
        totalVotes: 0,
        closesAt: '2026-06-30T23:30:00.000Z',
      }),
    );
    expect(text).toContain('clôture 1 juil.');
  });
});
