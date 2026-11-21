/**
 * Contrôles de vraisemblance d'un tracé calculé : un tracé douteux est refusé
 * (erreur) ou signalé (avertissement), jamais publié en silence.
 */
import { distanceM, longueurParcours, pointSurParcours, type Parcours, type Position } from '@petit-cortege/shared';
import { arrondir, normaliser } from './geocodage';

export const LONGUEUR_MIN_M = 200;
export const LONGUEUR_MAX_M = 15_000;
/** Un tracé piéton fait au plus ce multiple de la somme des distances à vol d'oiseau entre étapes. */
export const DETOUR_MAX = 1.8;
/** Le tracé doit passer à moins de cette distance de chaque étape. */
export const ECART_ETAPE_MAX_M = 60;
/** Demi-tour : angle entre deux tronçons au-delà duquel le tracé revient sur ses pas. */
const ANGLE_DEMI_TOUR = 160;
/** Tronçons ignorés pour les demi-tours (bruit du graphe autour d'un point d'étape). */
const TRONCON_DEMI_TOUR_MIN_M = 15;

export interface Constat {
  erreurs: string[];
  avertissements: string[];
}

/** Arrondit à 6 décimales (≈ 10 cm) et supprime les doublons consécutifs. */
export function nettoyerTrace(coordonnees: Position[]): Position[] {
  const resultat: Position[] = [];
  for (const [lon, lat] of coordonnees) {
    const p: Position = [arrondir(lon), arrondir(lat)];
    const dernier = resultat.at(-1);
    if (!dernier || dernier[0] !== p[0] || dernier[1] !== p[1]) resultat.push(p);
  }
  return resultat;
}

/** Somme des distances à vol d'oiseau entre points consécutifs. */
export function volDOiseau(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

/** Points du tracé tous les `pasM` mètres (et ses sommets), pour mesurer des distances au tracé. */
export function echantillonner(parcours: Parcours, pasM = 10): Position[] {
  const longueur = longueurParcours(parcours);
  const points: Position[] = [...parcours.coordinates];
  for (let d = 0; d < longueur; d += pasM) points.push(pointSurParcours(parcours, d));
  return points;
}

/** Distance minimale (m) entre `p` et le tracé échantillonné. */
export const distanceAuTrace = (echantillons: Position[], p: Position) =>
  Math.min(...echantillons.map((q) => distanceM(p, q)));

const ABREVIATIONS: Record<string, string> = {
  pl: 'place',
  r: 'rue',
  bd: 'boulevard',
  av: 'avenue',
  crs: 'cours',
  qu: 'quai',
  imp: 'impasse',
  all: 'allee',
  sq: 'square',
  pass: 'passage',
  ch: 'chemin',
  rte: 'route',
};

/** Nom de voie comparable : « PL STANISLAS » (IGN) = « Place Stanislas » (BAN). */
export function nomDeVoie(nom: string): string {
  return normaliser(nom)
    .split(' ')
    .map((mot, i) => (i === 0 ? (ABREVIATIONS[mot] ?? mot) : mot))
    .join(' ');
}

export interface ZoneGeocodee {
  nom: string;
  libelle: string;
  position: Position;
  rayonM: number;
}

export interface ATracer {
  parcours: Parcours;
  /** Points par lesquels l'itinéraire a été demandé (étapes et raccords des rues). */
  points: Position[];
  /** Rues empruntées selon le service d'itinéraire (noms éventuellement vides). */
  rues: { nom: string; m: number }[];
  zones: ZoneGeocodee[];
}

export function controlerTrace({ parcours, points, rues, zones }: ATracer): Constat {
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  const longueur = longueurParcours(parcours);
  const vol = volDOiseau(points);
  const km = (m: number) => `${(m / 1000).toFixed(2)} km`;

  if (longueur < LONGUEUR_MIN_M)
    erreurs.push(`tracé de ${Math.round(longueur)} m : trop court (minimum ${LONGUEUR_MIN_M} m).`);
  if (longueur > LONGUEUR_MAX_M) erreurs.push(`tracé de ${km(longueur)} : trop long (maximum ${km(LONGUEUR_MAX_M)}).`);
  // Arrondis et accroche au graphe : quelques mètres de moins que le vol d'oiseau sont normaux.
  if (longueur < vol * 0.97 - 20) {
    erreurs.push(
      `tracé de ${km(longueur)}, plus court que les ${km(vol)} à vol d'oiseau entre étapes : étapes sautées ?`,
    );
  }
  if (longueur > vol * DETOUR_MAX) {
    erreurs.push(
      `tracé de ${km(longueur)}, plus de ${DETOUR_MAX} × les ${km(vol)} à vol d'oiseau entre étapes : détour invraisemblable (étape mal placée ?).`,
    );
  }

  const echantillons = echantillonner(parcours);
  points.forEach((p, i) => {
    const ecart = distanceAuTrace(echantillons, p);
    if (ecart > ECART_ETAPE_MAX_M)
      erreurs.push(
        `le tracé passe à ${Math.round(ecart)} m du point n° ${i + 1} [${p.join(', ')}] (maximum ${ECART_ETAPE_MAX_M} m).`,
      );
  });
  const [depart, arrivee] = [parcours.coordinates[0]!, parcours.coordinates.at(-1)!];
  if (distanceM(depart, points[0]!) > ECART_ETAPE_MAX_M) erreurs.push(`le tracé ne part pas du départ annoncé.`);
  if (distanceM(arrivee, points.at(-1)!) > ECART_ETAPE_MAX_M)
    erreurs.push(`le tracé n'arrive pas à l'arrivée annoncée.`);

  for (const zone of zones) {
    const ecart = distanceAuTrace(echantillons, zone.position);
    if (ecart < zone.rayonM) {
      erreurs.push(
        `le tracé passe à ${Math.round(ecart)} m de ${zone.libelle} (zone à éviter, rayon ${zone.rayonM} m).`,
      );
    }
    const traversee = rues.find((r) => r.nom && nomDeVoie(r.nom) === nomDeVoie(zone.nom));
    if (traversee)
      erreurs.push(`le tracé emprunte « ${traversee.nom} » (${traversee.m} m) : zone à éviter (${zone.libelle}).`);
  }

  for (const d of demiTours(parcours.coordinates)) {
    avertissements.push(
      `demi-tour vers [${d.join(', ')}] : le tracé revient sur ses pas (aller-retour vers une étape ?).`,
    );
  }
  return { erreurs, avertissements };
}

/** Sommets où le tracé fait demi-tour (tronçons voisins assez longs pour ne pas être du bruit). */
export function demiTours(coordonnees: Position[]): Position[] {
  const resultat: Position[] = [];
  const cap = (a: Position, b: Position) => {
    const kx = Math.cos((a[1] * Math.PI) / 180);
    return (Math.atan2(b[1] - a[1], (b[0] - a[0]) * kx) * 180) / Math.PI;
  };
  for (let i = 1; i < coordonnees.length - 1; i++) {
    // Tronçons de part et d'autre, allongés jusqu'à la longueur minimale.
    const avant = reculer(coordonnees, i, -1);
    const apres = reculer(coordonnees, i, +1);
    if (!avant || !apres) continue;
    const p = coordonnees[i]!;
    let angle = Math.abs(cap(avant, p) - cap(p, apres));
    if (angle > 180) angle = 360 - angle;
    if (angle >= ANGLE_DEMI_TOUR && !resultat.some((q) => distanceM(q, p) < 50)) resultat.push(p);
  }
  return resultat;
}

function reculer(c: Position[], i: number, sens: -1 | 1): Position | undefined {
  for (let j = i + sens; j >= 0 && j < c.length; j += sens) {
    if (distanceM(c[i]!, c[j]!) >= TRONCON_DEMI_TOUR_MIN_M) return c[j];
  }
  return undefined;
}
