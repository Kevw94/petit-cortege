/**
 * Point d'écoute du son (`son/ambiance.ts`) depuis une vue : à quelle distance la caméra
 * regarde le sol, et à quelle distance ce point est de la foule. Partie pure, sans
 * Phaser ni Three.js : les vues lui passent leurs positions déjà calculées.
 */
import type { PointDEcoute } from './son/ambiance';

/** Intervalle minimal entre deux points d'écoute envoyés au son (ms) : le calcul parcourt la foule. */
export const INTERVALLE_ECOUTE_MS = 500;

/** Champ vertical supposé d'une vue de dessus (comme la caméra 3D). */
const CHAMP_VERTICAL_DEG = 50;

/** Distance du point `centre` au plus proche des `elements` (mêmes unités) ; 0 s'il n'y en a aucun. */
export function ecartAuPlusProche<T>(
  elements: readonly T[],
  position: (e: T) => { x: number; y: number },
  centre: { x: number; y: number },
): number {
  if (elements.length === 0) return 0;
  let min = Infinity;
  for (const e of elements) {
    const p = position(e);
    const d = (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}

/**
 * Vue de dessus (2D) : la « caméra » est à la hauteur d'où l'on verrait l'écran entier
 * avec un champ de 50°, au-dessus du centre de l'écran.
 * @param places avatars en pixels d'écran
 */
export function pointDEcouteDeDessus(
  places: readonly { x: number; y: number }[],
  ecran: { largeur: number; hauteur: number },
  echellePxParM: number,
): PointDEcoute {
  const demiHauteurM = ecran.hauteur / 2 / echellePxParM;
  const centre = { x: ecran.largeur / 2, y: ecran.hauteur / 2 };
  return {
    hauteurM: demiHauteurM / Math.tan((CHAMP_VERTICAL_DEG * Math.PI) / 360),
    ecartM: ecartAuPlusProche(places, (p) => p, centre) / echellePxParM,
  };
}
