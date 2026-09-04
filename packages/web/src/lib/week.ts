/**
 * Bornes de la semaine courante, en heure **locale du navigateur**.
 *
 * Une seule définition de « cette semaine » pour deux consommateurs qui
 * doivent s'accorder au jour près :
 *   - `useHomeFeed` les envoie au backend (`weekStart`/`weekEnd`), qui ne
 *     retourne que les events tombant dedans ;
 *   - `WeekCalendar` dessine sa grille Lundi → Dimanche à partir des mêmes
 *     bornes et y range chaque event.
 *
 * Si les deux les recalculaient chacun de leur côté, la moindre divergence
 * (fuseau, changement d'heure, minuit franchi entre deux renders) ferait
 * arriver des events qu'aucune case n'accueille — invisibles, sans erreur.
 *
 * Le fuseau est celui de l'utilisateur, jamais celui du serveur : c'est lui
 * qui décide si un événement du dimanche 23 h appartient à cette semaine.
 */

/** Minuit, lundi de la semaine contenant `now` (heure locale). */
export function startOfWeekLocal(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay() : 0 = dimanche → 6 = samedi. On le ramène à un offset depuis lundi.
  const dayOfWeek = start.getDay();
  start.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return start;
}

/**
 * Intervalle **semi-ouvert** `[start, end)` : lundi 00:00 → lundi suivant
 * 00:00. Un event à minuit pile appartient au jour qui commence, jamais aux
 * deux — et aucun instant de la semaine n'échappe à l'intervalle.
 */
export function currentWeekBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = startOfWeekLocal(now);
  const end = new Date(start);
  // `setDate` gère le débordement de mois et les changements d'heure : +7 jours
  // civils, pas +7×24 h.
  end.setDate(start.getDate() + 7);
  return { start, end };
}

/** Une case du calendrier : l'intervalle semi-ouvert `[start, end)` d'un jour. */
export interface DayWindow {
  start: Date;
  end: Date;
}

/**
 * Les 7 fenêtres de jour de la semaine, chacune bornée par le **minuit civil**
 * du jour suivant.
 *
 * Civil, et non `+24 h` : un jour ne fait pas toujours 24 heures. Le dimanche
 * du passage à l'heure d'hiver en fait 25. Une borne de fin calculée en
 * millisecondes tombait alors une heure trop tôt, et la dernière heure de ce
 * dimanche n'appartenait à aucune case — l'événement était renvoyé par le
 * backend et n'apparaissait nulle part, sans erreur ni trace.
 *
 * Les 7 fenêtres pavent exactement `[weekStart, weekEnd)`, l'intervalle envoyé
 * au backend : ni trou, ni recouvrement. C'est cet invariant qui garantit qu'un
 * événement accepté par le serveur trouve toujours une case.
 */
export function weekDayWindows(now: Date = new Date()): DayWindow[] {
  const monday = startOfWeekLocal(now);
  const windows: DayWindow[] = [];
  let start = monday;
  for (let i = 1; i <= 7; i++) {
    const end = new Date(monday);
    end.setDate(monday.getDate() + i);
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

/** Range chaque event dans la fenêtre `[start, end)` qui contient son `startsAt`. */
export function bucketByDay<E extends { startsAt: string }>(
  events: E[],
  windows: DayWindow[],
): E[][] {
  return windows.map(({ start, end }) => {
    const from = start.getTime();
    const to = end.getTime();
    return events.filter((e) => {
      const t = new Date(e.startsAt).getTime();
      return t >= from && t < to;
    });
  });
}
