/**
 * Bornes de semaine — le cas qui casse est le dimanche.
 *
 * `getDay()` numérote la semaine à l'américaine (0 = dimanche), donc un
 * `date - getDay() + 1` naïf projette le dimanche sur le **lundi suivant** :
 * la grille sauterait d'une semaine entière le jour où l'utilisateur en a le
 * plus besoin pour regarder ce qui vient de se passer.
 */
import { describe, expect, it } from 'vitest';

import { bucketByDay, currentWeekBounds, startOfWeekLocal, weekDayWindows } from './week';

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

describe('weekDayWindows', () => {
  it('rend 7 fenêtres, de lundi à dimanche', () => {
    const windows = weekDayWindows(local(2026, 9, 16));
    expect(windows).toHaveLength(7);
    expect(windows[0]?.start.getDate()).toBe(14); // lundi
    expect(windows[6]?.start.getDate()).toBe(20); // dimanche
  });

  it('pave exactement l’intervalle envoyé au backend', () => {
    // L'invariant qui rend la grille sûre : la 1re borne EST `weekStart`, la
    // dernière EST `weekEnd`. Un event accepté par le backend tombe donc
    // forcément dans une case — c'est ce qui rendait la disparition possible.
    const now = local(2026, 9, 16);
    const { start, end } = currentWeekBounds(now);
    const windows = weekDayWindows(now);
    expect(windows[0]?.start.getTime()).toBe(start.getTime());
    expect(windows[6]?.end.getTime()).toBe(end.getTime());
  });

  it('est contigu : la fin d’un jour est le début du suivant', () => {
    // Ni trou ni recouvrement entre deux cases — sans quoi un event peut
    // disparaître ou apparaître deux fois.
    const windows = weekDayWindows(local(2026, 9, 16));
    for (let i = 0; i < windows.length - 1; i++) {
      expect(windows[i]?.end.getTime()).toBe(windows[i + 1]?.start.getTime());
    }
  });

  it('avance en jours civils, pas en tranches de 24 h', () => {
    // Chaque borne est un minuit local. Sous un fuseau à changement d'heure,
    // deux bornes consécutives peuvent être distantes de 23 ou 25 h — c'est
    // précisément ce qu'une addition de millisecondes rate.
    for (const w of weekDayWindows(local(2026, 9, 16))) {
      expect([w.start.getHours(), w.start.getMinutes(), w.start.getSeconds()]).toEqual([0, 0, 0]);
    }
  });
});

describe('bucketByDay', () => {
  /** Fenêtres fabriquées à la main : indépendantes du fuseau de la machine, donc
   *  le test vaut autant sur la CI (UTC) que sur un poste en Europe/Paris. */
  function windowsFrom(...isos: string[]) {
    const out: { start: Date; end: Date }[] = [];
    let prev: Date | undefined;
    for (const iso of isos) {
      const d = new Date(iso);
      if (prev) out.push({ start: prev, end: d });
      prev = d;
    }
    return out;
  }

  it('range chaque event dans sa case', () => {
    const windows = windowsFrom(
      '2026-09-14T00:00:00Z',
      '2026-09-15T00:00:00Z',
      '2026-09-16T00:00:00Z',
    );
    const out = bucketByDay(
      [
        { id: 'a', startsAt: '2026-09-14T19:00:00Z' },
        { id: 'b', startsAt: '2026-09-15T08:00:00Z' },
      ],
      windows,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.map((e) => e.id)).toEqual(['a']);
    expect(out[1]?.map((e) => e.id)).toEqual(['b']);
  });

  it('place un event à minuit pile dans le jour qui COMMENCE', () => {
    const windows = windowsFrom(
      '2026-09-14T00:00:00Z',
      '2026-09-15T00:00:00Z',
      '2026-09-16T00:00:00Z',
    );
    const out = bucketByDay([{ id: 'minuit', startsAt: '2026-09-15T00:00:00Z' }], windows);
    expect(out[0]).toEqual([]);
    expect(out[1]?.map((e) => e.id)).toEqual(['minuit']);
  });

  it('n’en perd aucun sur un jour de 25 h (passage à l’heure d’hiver)', () => {
    // Le bug corrigé : la case se terminait à `début + 24 h`, soit 23:00 local
    // ce dimanche-là. Un event à 23:30 était renvoyé par le backend (il est
    // avant `weekEnd`) et n'entrait dans aucune case — invisible, sans erreur.
    // Bornes réelles d'Europe/Paris pour la semaine du 19 octobre 2026.
    const out = bucketByDay(
      [{ id: 'derniere-heure', startsAt: '2026-10-25T22:30:00Z' }],
      windowsFrom(
        '2026-10-24T22:00:00Z', // dimanche 25 oct. 00:00 CEST
        '2026-10-25T23:00:00Z', // lundi 26 oct. 00:00 CET — 25 h plus tard
      ),
    );
    expect(out[0]?.map((e) => e.id)).toEqual(['derniere-heure']);
  });

  it('ne compte pas deux fois un event sur un jour de 23 h', () => {
    // Symétrie printanière : la fenêtre fixe de 24 h débordait sur la première
    // heure du lendemain, qui affichait alors l'event une seconde fois.
    const windows = windowsFrom(
      '2026-03-28T23:00:00Z', // dimanche 29 mars 00:00 CET
      '2026-03-29T22:00:00Z', // lundi 30 mars 00:00 CEST — 23 h plus tard
      '2026-03-30T22:00:00Z',
    );
    const out = bucketByDay([{ id: 'lundi-tot', startsAt: '2026-03-29T22:30:00Z' }], windows);
    expect(out[0]).toEqual([]);
    expect(out[1]?.map((e) => e.id)).toEqual(['lundi-tot']);
  });
});
