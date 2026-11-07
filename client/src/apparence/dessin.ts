/**
 * Précomposition d'une apparence sur un canvas 2D à partir de l'atlas des couches
 * généré par `npm run generer-apparence` : utilisée par la scène (texture des
 * apparences) et par l'aperçu du panneau de composition.
 */
import type { DescriptionAtlasApparence } from '@petit-cortege/shared';
import description from '../assets/apparence/couches.json';
import urlCouches from '../assets/apparence/couches.png?url';
import { couchesPourIndice } from './affichage';

export const ATLAS_APPARENCE = description as unknown as DescriptionAtlasApparence;
export const URL_COUCHES_APPARENCE = urlCouches;
/** Taille d'une apparence précomposée (pixels de l'atlas), pieds au milieu du bas. */
export const CELLULE_APPARENCE = ATLAS_APPARENCE.cellule;
/** Hauteur de la tête au-dessus des pieds, en pixels de l'atlas (haut du crâne Kenney). */
export const HAUTEUR_TETE_PX = CELLULE_APPARENCE.hauteur - 2;

/** Dessine l'apparence `indice` avec son coin haut-gauche en (x, y), à l'échelle 1. */
export function dessinerApparence(
  contexte: CanvasRenderingContext2D,
  couches: CanvasImageSource,
  indice: number,
  x: number,
  y: number,
): void {
  const { largeur, hauteur } = CELLULE_APPARENCE;
  for (const nom of couchesPourIndice(indice)) {
    const cadre = ATLAS_APPARENCE.cadres[nom];
    if (cadre) contexte.drawImage(couches, cadre[0], cadre[1], largeur, hauteur, x, y, largeur, hauteur);
  }
}
