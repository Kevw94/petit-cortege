/**
 * Cadrage de la vue : quel morceau de la ville est à l'écran, à quel zoom.
 * Fonctions pures en mètres (projection locale) et pixels ; la scène les
 * branche sur les gestes (pincer, glisser, molette).
 *
 * Minimal pour lire les pancartes au zoom (#11) ; le décor (#12) pourra le
 * remplacer par la caméra Phaser.
 */

export interface PointM {
  x: number;
  y: number;
}
export interface PointPx {
  x: number;
  y: number;
}
export interface Ecran {
  largeur: number;
  hauteur: number;
}
export interface Emprise {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Cadrage {
  /** Zoom, en pixels par mètre. */
  echelle: number;
  /** Point (mètres) affiché au centre de l'écran. */
  centre: PointM;
  /** Zoom minimal : un peu en deçà de la vue d'ensemble. */
  echelleMin: number;
}

/** Zoom maximal : une pancarte fait alors une centaine de pixels de large. */
export const ECHELLE_MAX_PX_PAR_M = 64;

/** Vue d'ensemble : l'emprise entière tient à l'écran, centrée, avec une marge. */
export function cadrerSur(emprise: Emprise, ecran: Ecran, margePx: number): Cadrage {
  const echelle = Math.min(
    (ecran.largeur - 2 * margePx) / Math.max(emprise.maxX - emprise.minX, 1),
    (ecran.hauteur - 2 * margePx) / Math.max(emprise.maxY - emprise.minY, 1),
  );
  return {
    echelle,
    centre: { x: (emprise.minX + emprise.maxX) / 2, y: (emprise.minY + emprise.maxY) / 2 },
    echelleMin: Math.min(echelle / 2, ECHELLE_MAX_PX_PAR_M),
  };
}

/** Projection mètres → pixels pour ce cadrage. */
export function versEcran(cadrage: Cadrage, ecran: Ecran): (p: PointM) => PointPx {
  const { echelle, centre } = cadrage;
  return (p) => ({
    x: (p.x - centre.x) * echelle + ecran.largeur / 2,
    y: (p.y - centre.y) * echelle + ecran.hauteur / 2,
  });
}

/** Zoome d'un facteur en gardant fixe le point de l'écran sous le doigt (ou la souris). */
export function zoomerAutour(cadrage: Cadrage, facteur: number, point: PointPx, ecran: Ecran): Cadrage {
  const echelle = Math.min(Math.max(cadrage.echelle * facteur, cadrage.echelleMin), ECHELLE_MAX_PX_PAR_M);
  // Point du monde sous le doigt, qui doit y rester.
  const sousLeDoigt = {
    x: cadrage.centre.x + (point.x - ecran.largeur / 2) / cadrage.echelle,
    y: cadrage.centre.y + (point.y - ecran.hauteur / 2) / cadrage.echelle,
  };
  return {
    ...cadrage,
    echelle,
    centre: {
      x: sousLeDoigt.x - (point.x - ecran.largeur / 2) / echelle,
      y: sousLeDoigt.y - (point.y - ecran.hauteur / 2) / echelle,
    },
  };
}

/** Déplace la vue du glissement du doigt (en pixels) : le monde suit le doigt. */
export function deplacer(cadrage: Cadrage, glissement: PointPx): Cadrage {
  return {
    ...cadrage,
    centre: { x: cadrage.centre.x - glissement.x / cadrage.echelle, y: cadrage.centre.y - glissement.y / cadrage.echelle },
  };
}
