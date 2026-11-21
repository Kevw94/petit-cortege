/** Vitesse de marche du cortège (ADR 0004). */
export const VITESSE_KMH = 2;
export const VITESSE_M_PAR_MS = (VITESSE_KMH * 1000) / 3_600_000;

/** Écart entre deux avatars voisins du cortège : une tuile de 16 px ≈ 2 m (ADR 0006). */
export const PAS_FOULE_M = 2;
/** Nombre d'avatars de front sur la largeur de la rue. */
export const COLONNES_FOULE = 5;

/**
 * Retard maximal de la queue sur la tête (ADR 0004) : au-delà, tout le cortège est
 * considéré arrivé sur la place, même s'il est très long.
 */
export const RETARD_MAX_QUEUE_MS = 60 * 60 * 1000;
/** Danse finale : tout le cortège danse sur la place avant la photo (image finale). */
export const DUREE_DANSE_MS = 10 * 60 * 1000;

/**
 * Arrivée de la tête au bout du parcours (départ + longueur ÷ 2 km/h). C'est aussi la
 * fermeture des entrées : ensuite, la longueur du cortège, donc sa fin, est connue.
 */
export function arriveeDeLaTete(depart: Date, longueurM: number): Date {
  return new Date(depart.getTime() + longueurM / VITESSE_M_PAR_MS);
}

/**
 * Retard de la queue sur la tête pour `soutiens` avatars : sa dernière rangée est à
 * `rangées × 2 m` derrière la tête (5 de front), plafonné à `RETARD_MAX_QUEUE_MS`.
 */
export function retardDeLaQueueMs(soutiens: number): number {
  const derniereRangee = Math.max(0, Math.ceil(soutiens / COLONNES_FOULE) - 1);
  return Math.min(RETARD_MAX_QUEUE_MS, (derniereRangee * PAS_FOULE_M) / VITESSE_M_PAR_MS);
}

/**
 * Fin = arrivée de la queue sur la place (plafonnée à 1 h après la tête) + danse finale.
 * `soutiens` compte tous les avatars entrés, retirés compris : la fin ne recule pas sur un
 * retrait. Les entrées fermant à l'arrivée de la tête, la fin est fixée dès ce moment ;
 * avant, elle ne peut que reculer à mesure que des soutiens entrent.
 */
export function calculerFin(depart: Date, longueurM: number, soutiens: number): Date {
  return new Date(arriveeDeLaTete(depart, longueurM).getTime() + retardDeLaQueueMs(soutiens) + DUREE_DANSE_MS);
}

/** Début de la danse finale : 10 min avant la fin, tout le cortège est sur la place. */
export function debutDeLaDanse(fin: Date): Date {
  return new Date(fin.getTime() - DUREE_DANSE_MS);
}

export const MINUTE_MS = 60_000;
export const HEURE_MS = 60 * MINUTE_MS;

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

/**
 * Durée pendant laquelle une manif terminée reste dans la liste publiée, pour revoir
 * son image finale (story 43) : 30 jours après la fin. Ensuite elle sort de la liste,
 * et ses retraits du fichier des retraits.
 */
export const CONSULTATION_APRES_FIN_MS = 30 * 24 * HEURE_MS;
