/**
 * Bornes de semaine — le cas qui casse est le dimanche.
 *
 * `getDay()` numérote la semaine à l'américaine (0 = dimanche), donc un
 * `date - getDay() + 1` naïf projette le dimanche sur le **lundi suivant** :
 * la grille sauterait d'une semaine entière le jour où l'utilisateur en a le
 * plus besoin pour regarder ce qui vient de se passer.
 */
import { describe, expect, it } from 'vitest';

import { currentWeekBounds, startOfWeekLocal } from './week';

/** Construit une date en heure LOCALE — `new Date('...Z')` serait en UTC et
 *  décalerait le jour testé d'un fuseau à l'autre. */
function local(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h, 0, 0, 0);
}

describe('startOfWeekLocal', () => {
  it('ramène un mercredi au lundi de sa semaine', () => {
    // Mercredi 16 septembre 2026 → lundi 14.
    expect(startOfWeekLocal(local(2026, 9, 16)).getDate()).toBe(14);
  });

  it('laisse un lundi sur place', () => {
    expect(startOfWeekLocal(local(2026, 9, 14)).getDate()).toBe(14);
  });

  it('ramène un dimanche au lundi qui PRÉCÈDE, pas à celui qui suit', () => {
    // Dimanche 20 septembre 2026 → lundi 14, pas lundi 21.
    expect(startOfWeekLocal(local(2026, 9, 20)).getDate()).toBe(14);
  });

  it('remonte au mois précédent quand la semaine est à cheval', () => {
    // Jeudi 1er octobre 2026 → lundi 28 septembre.
    const start = startOfWeekLocal(local(2026, 10, 1));
    expect(start.getMonth()).toBe(8); // septembre (0-indexé)
    expect(start.getDate()).toBe(28);
  });

  it('normalise à minuit', () => {
    const start = startOfWeekLocal(local(2026, 9, 16, 23));
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe('currentWeekBounds', () => {
  it('couvre 7 jours civils, lundi 00:00 → lundi suivant 00:00', () => {
    const { start, end } = currentWeekBounds(local(2026, 9, 16));
    expect(start.getDate()).toBe(14);
    expect(end.getDate()).toBe(21);
    expect(end.getHours()).toBe(0);
  });

  it('est semi-ouvert : dimanche 23:59:59 dedans, lundi suivant 00:00 dehors', () => {
    const { start, end } = currentWeekBounds(local(2026, 9, 16));

    const sundayNight = new Date(end.getTime() - 1000);
    expect(sundayNight.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(sundayNight.getTime()).toBeLessThan(end.getTime());

    // La borne haute EST le début de la semaine suivante : ni trou, ni
    // recouvrement entre deux semaines consécutives. C'est ce qui garantit
    // qu'aucun instant ne tombe dans les deux, ni dans aucune.
    expect(startOfWeekLocal(end).getTime()).toBe(end.getTime());
    expect(end.getDay()).toBe(1); // lundi
  });
});
