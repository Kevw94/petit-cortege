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
/** Inclinaison sous l'horizon au plus près (vue de trois quarts) et au plus loin (presque à la verticale). */
const INCLINAISON_PROCHE = (30 * Math.PI) / 180;
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
  const inclinaison = INCLINAISON_PROCHE + (INCLINAISON_LOIN - INCLINAISON_PROCHE) * (1 - (1 - z) ** 2);
  return { distance, inclinaison, hauteur: distance * Math.sin(inclinaison), recul: distance * Math.cos(inclinaison) };
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

/** Caméra derrière la cible selon le cap, à `distance`, inclinée de `inclinaison` sous l'horizon. */
export function poseCamera(options: { cible: PointM; cap: number; distance: number; inclinaison: number }): PoseCamera {
  const { cible, cap, distance, inclinaison } = options;
  const regard = versScene(cible, HAUTEUR_REGARD_M);
  const recul = distance * Math.cos(inclinaison);
  return {
    regard,
    position: {
      x: regard.x - Math.cos(cap) * recul,
      y: regard.y + distance * Math.sin(inclinaison),
      z: regard.z - Math.sin(cap) * recul,
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
