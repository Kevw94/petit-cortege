/**
 * Caméra de la vue 3D, partie pure (sans Three.js) : derrière son avatar (ou la tête du
 * cortège), un peu au-dessus, inclinée vers l'avant, tournée dans le sens de la marche ;
 * le dézoom la fait reculer et monter jusqu'à la vue de haut sur tout le parcours.
 *
 * Angles en radians dans le plan du sol (mètres, x vers l'est, y vers le sud) : 0 = vers
 * l'est, positif vers le sud.
 */
import type { PointM } from '../cadrage';
import { versScene, type Placeur, type Point3 } from './repere';

/** Ramène un angle dans ]-π, π]. */
function normaliser(angle: number): number {
  const a = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return a === -Math.PI ? Math.PI : a;
}

/** Rapproche `courant` de `cible` d'une part `facteur` de l'écart, par le plus court chemin. */
export function rapprocherAngle(courant: number, cible: number, facteur: number): number {
  return normaliser(courant + normaliser(cible - courant) * facteur);
}

/** Fenêtre le long du parcours dont la corde donne l'orientation : on regarde un peu devant. */
const REGARD_ARRIERE_M = 15;
const REGARD_AVANT_M = 30;

/**
 * Orientation de la caméra qui suit le point à `distance` mètres du départ : la direction de
 * la corde entre un point un peu derrière et un point un peu devant, sur l'axe du parcours.
 * Elle commence à tourner avant un virage et tourne progressivement, sans saut.
 */
export function capDeSuivi(placeur: Placeur, distance: number): number {
  const a = placeur.placer(distance - REGARD_ARRIERE_M, 0);
  const b = placeur.placer(distance + REGARD_AVANT_M, 0);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return placeur.cap(distance);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Distance au point regardé au plus près (zoom 0) : l'avatar (2 m) et ses voisins occupent le bas de l'écran. */
export const DISTANCE_PROCHE_M = 9;
/** Distance du suivi par défaut : son avatar et la foule autour, la rue devant. */
export const DISTANCE_SUIVI_M = 28;
/** Champ de vision vertical de la caméra (degrés). */
export const CHAMP_VERTICAL_DEG = 50;
/** Inclinaison sous l'horizon au plus près (vue de trois quarts) et au plus loin (presque à la verticale). */
const INCLINAISON_PROCHE = (16 * Math.PI) / 180;
/**
 * De près, le regard est porté devant la cible, d'une part de la distance : la caméra
 * reste derrière son avatar, mais regarde plus loin dans la rue, jusqu'à l'horizon.
 * Cette avance s'efface en dézoomant (de haut, on regarde le parcours à la verticale).
 */
const AVANCE_REGARD = 0.6;
const INCLINAISON_LOIN = (89.5 * Math.PI) / 180;
/** Le regard est porté au-dessus de la tête : de près, l'avatar et sa pancarte sont à l'écran. */
const HAUTEUR_REGARD_M = 2.5;

const borner = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const lisser = (a: number, b: number, t: number) => {
  const u = borner((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

export interface ParametresZoom {
  /** Distance de la caméra au point regardé (m). */
  distance: number;
  /** Angle du regard sous l'horizon (radians). */
  inclinaison: number;
  /** Hauteur de la caméra au-dessus du point regardé, et recul horizontal derrière lui (m). */
  hauteur: number;
  recul: number;
  /** Distance devant la cible, dans le sens de la marche, où se porte le regard (m). */
  avance: number;
}

/**
 * Zoom (0 : au plus près, 1 : vue de haut sur tout le parcours) → position de la caméra.
 * La distance est interpolée en échelle logarithmique (un cran de molette ou un pincement
 * fait le même effet de près comme de loin) ; l'inclinaison se redresse progressivement.
 */
export function parametresZoom(zoom: number, distanceLoin: number): ParametresZoom {
  const z = borner(zoom, 0, 1);
  const loin = Math.max(distanceLoin, DISTANCE_PROCHE_M);
  const distance = z === 1 ? loin : DISTANCE_PROCHE_M * (loin / DISTANCE_PROCHE_M) ** z;
  // Se redresse vite au début (au zoom du suivi, ≈ 50° : la foule devant la caméra masque moins
  // son avatar), puis doucement jusqu'à la verticale.
  // Rasante jusqu'au zoom de suivi (l'horizon reste à l'écran), puis se redresse vers la verticale.
  const inclinaison = INCLINAISON_PROCHE + (INCLINAISON_LOIN - INCLINAISON_PROCHE) * lisser(0.2, 1, z);
  const avance = distance * AVANCE_REGARD * (1 - lisser(0.3, 0.8, z));
  return { distance, inclinaison, hauteur: distance * Math.sin(inclinaison), recul: distance * Math.cos(inclinaison), avance };
}

/** Zoom qui place la caméra à `distance` du point regardé (borné à [0, 1]). */
export function zoomPourDistance(distance: number, distanceLoin: number): number {
  const loin = Math.max(distanceLoin, DISTANCE_PROCHE_M * 1.0001);
  return borner(Math.log(distance / DISTANCE_PROCHE_M) / Math.log(loin / DISTANCE_PROCHE_M), 0, 1);
}

/** Pincement (ou cran de molette) : écarter les doigts d'un `rapport` rapproche la caméra d'autant. */
export function zoomApresPincement(zoom: number, rapport: number, distanceLoin: number): number {
  return zoomPourDistance(parametresZoom(zoom, distanceLoin).distance / rapport, distanceLoin);
}

/** Distance à la verticale pour qu'un cercle de `rayon` mètres tienne dans l'écran. */
export function distancePourToutVoir(rayon: number, champVerticalDeg: number, aspect: number): number {
  const demiV = Math.tan((champVerticalDeg * Math.PI) / 360);
  return rayon / Math.min(demiV, demiV * aspect);
}

/**
 * Point regardé : de près, la cible suivie (son avatar, la tête du cortège) ; en montant
 * vers la vue de haut, il glisse vers le centre du parcours.
 */
export function cibleDeVue(suivie: PointM, centreParcours: PointM, zoom: number): PointM {
  const f = lisser(0.5, 1, zoom);
  if (f === 0) return { ...suivie };
  if (f === 1) return { ...centreParcours };
  return { x: suivie.x + (centreParcours.x - suivie.x) * f, y: suivie.y + (centreParcours.y - suivie.y) * f };
}

export interface PoseCamera {
  position: Point3;
  regard: Point3;
}

/**
 * Caméra derrière la cible selon le cap, à `distance`, placée à `inclinaison` sous l'horizon
 * vue de la cible ; le regard se porte `avance` mètres devant la cible (0 : sur elle).
 */
export function poseCamera(options: {
  cible: PointM;
  cap: number;
  distance: number;
  inclinaison: number;
  avance?: number;
}): PoseCamera {
  const { cible, cap, distance, inclinaison, avance = 0 } = options;
  const surCible = versScene(cible, HAUTEUR_REGARD_M);
  const recul = distance * Math.cos(inclinaison);
  return {
    regard: { x: surCible.x + Math.cos(cap) * avance, y: surCible.y, z: surCible.z + Math.sin(cap) * avance },
    position: {
      x: surCible.x - Math.cos(cap) * recul,
      y: surCible.y + distance * Math.sin(inclinaison),
      z: surCible.z - Math.sin(cap) * recul,
    },
  };
}

/**
 * Glisser la vue (vue détachée) : le sol suit le doigt. `metresParPx` : mètres au sol par
 * pixel d'écran autour du point regardé ; `cap` : direction du regard.
 */
export function deplacerCible(cible: PointM, cap: number, glissement: { x: number; y: number }, metresParPx: number): PointM {
  const avant = { x: Math.cos(cap), y: Math.sin(cap) };
  // Droite de l'écran au sol (y vers le sud) : (-avant.y, avant.x).
  const droite = { x: -avant.y, y: avant.x };
  return {
    x: cible.x - droite.x * glissement.x * metresParPx + avant.x * glissement.y * metresParPx,
    y: cible.y - droite.y * glissement.x * metresParPx + avant.y * glissement.y * metresParPx,
  };
}

/** Portée des noms de places de près : au-delà, ils s'empileraient sur l'horizon. */
export const PORTEE_NOMS_DE_PLACES_M = 350;

/**
 * Un nom de place s'affiche s'il est assez proche de la caméra (distance au sol, en mètres) ;
 * en dézoomant, la portée grandit avec la distance de la caméra, jusqu'à tout montrer de haut.
 */
export function nomDePlaceVisible(distanceAuNomM: number, distanceCameraM: number): boolean {
  return distanceAuNomM <= Math.max(PORTEE_NOMS_DE_PLACES_M, distanceCameraM * 2);
}
