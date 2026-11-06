/** Vitesse de marche du cortège (ADR 0004). */
export const VITESSE_KMH = 2;
export const VITESSE_M_PAR_MS = (VITESSE_KMH * 1000) / 3_600_000;

/** Marge ajoutée après l'arrivée théorique de la tête avant la fin (ADR 0004). */
export const MARGE_FIN_MS = 60 * 60 * 1000;

export const MINUTE_MS = 60_000;

/** Fin = départ + longueur ÷ 2 km/h + marge. */
export function calculerFin(depart: Date, longueurM: number): Date {
  return new Date(depart.getTime() + longueurM / VITESSE_M_PAR_MS + MARGE_FIN_MS);
}

/** Début de la minute UTC qui contient `instant`. */
export function debutDeMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS);
}

/**
 * Minutes dont le fichier d'entrées concerne une manif et est déjà publiable à
 * `maintenant` : de la minute d'ouverture jusqu'à la fin, limitées aux minutes
 * complètement écoulées.
 */
export function minutesPubliees(manif: { ouverture: string; fin: string }, maintenant: Date): Date[] {
  const minutes: Date[] = [];
  const fin = Date.parse(manif.fin);
  const derniere = debutDeMinute(maintenant).getTime(); // minute en cours, non publiée
  for (let m = debutDeMinute(new Date(manif.ouverture)).getTime(); m < fin && m < derniere; m += MINUTE_MS) {
    minutes.push(new Date(m));
  }
  return minutes;
}
