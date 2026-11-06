/** Vitesse de marche du cortège (ADR 0004). */
export const VITESSE_KMH = 2;
export const VITESSE_M_PAR_MS = (VITESSE_KMH * 1000) / 3_600_000;

/** Marge ajoutée après l'arrivée théorique de la tête avant la fin (ADR 0004). */
export const MARGE_FIN_MS = 60 * 60 * 1000;

export const MINUTE_MS = 60_000;
export const HEURE_MS = 60 * MINUTE_MS;

/** Fin = départ + longueur ÷ 2 km/h + marge. */
export function calculerFin(depart: Date, longueurM: number): Date {
  return new Date(depart.getTime() + longueurM / VITESSE_M_PAR_MS + MARGE_FIN_MS);
}

/** Début de la minute UTC qui contient `instant`. */
export function debutDeMinute(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS);
}

/** Début de l'heure UTC qui contient `instant`. */
export function debutDHeure(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HEURE_MS) * HEURE_MS);
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

/** Une heure terminée : son fichier horaire remplace les fichiers par minute listés. */
export interface HeurePubliee {
  heure: Date;
  /** Minutes publiées de la manif dans cette heure (ce que le fichier horaire compacte). */
  minutes: Date[];
}

/**
 * Fichiers à lire pour une manif à `maintenant` (serveur : quoi compacter ;
 * client : quoi charger). Les minutes publiées des heures terminées sont
 * regroupées par heure (un fichier horaire chacune) ; celles de l'heure en
 * cours restent des fichiers par minute. Une heure est terminée dès que
 * `maintenant` a atteint l'heure suivante, en même temps que sa dernière
 * minute devient publiable.
 */
export function fichiersPublies(
  manif: { ouverture: string; fin: string },
  maintenant: Date,
): { heures: HeurePubliee[]; minutes: Date[] } {
  const heureEnCours = debutDHeure(maintenant).getTime();
  const heures: HeurePubliee[] = [];
  const minutes: Date[] = [];
  for (const minute of minutesPubliees(manif, maintenant)) {
    const heure = debutDHeure(minute).getTime();
    if (heure >= heureEnCours) {
      minutes.push(minute);
      continue;
    }
    const derniere = heures[heures.length - 1];
    if (derniere?.heure.getTime() === heure) derniere.minutes.push(minute);
    else heures.push({ heure: new Date(heure), minutes: [minute] });
  }
  return { heures, minutes };
}
