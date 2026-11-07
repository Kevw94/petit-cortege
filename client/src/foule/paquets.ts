/**
 * Paquets de la masse de foule : quelques avatars serrés, composés à partir des couches
 * Kenney de l'atlas d'apparence (mêmes pièces et même palette que les avatars, aucun dessin
 * à la main), sur un canvas 2D. Partagé par la vue 2D (foule/masse.ts) et la vue 3D.
 */
import { apparenceAuHasard, encoderApparence } from '@petit-cortege/shared';
import { CELLULE_APPARENCE, dessinerApparence } from '../apparence/dessin';

/** Un paquet : quelques avatars serrés sur trois rangs (pixels de l'atlas, 5 m × 3,25 m). */
export const PAQUET = { largeur: 40, hauteur: 26 } as const;
export const VARIANTES_PAQUET = 8;
/** Rangs d'un paquet : hauteur des pieds et nombre d'avatars, du fond vers l'avant. */
const RANGS = [
  { pieds: 14, nombre: 4 },
  { pieds: 20, nombre: 5 },
  { pieds: 26, nombre: 4 },
] as const;
/** La masse est un peu assombrie : les avatars tirés au premier plan s'en détachent. */
export const TEINTE_MASSE = 0xb4b4bc;

/** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes paquets chez tout le monde. */
function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dessine les VARIANTES_PAQUET paquets côte à côte (paquet v en x = v × PAQUET.largeur),
 * identiques chez tout le monde (tirage seedé).
 */
export function dessinerPaquets(contexte: CanvasRenderingContext2D, couches: CanvasImageSource): void {
  for (let v = 0; v < VARIANTES_PAQUET; v++) {
    const hasard = alea(0x5eed + v);
    const x0 = v * PAQUET.largeur;
    contexte.save();
    contexte.beginPath();
    contexte.rect(x0, 0, PAQUET.largeur, PAQUET.hauteur);
    contexte.clip();
    for (const { pieds, nombre } of RANGS) {
      const ecart = PAQUET.largeur / nombre;
      for (let i = 0; i < nombre; i++) {
        const centre = Math.round(x0 + (i + 0.5) * ecart + (hasard() - 0.5) * ecart * 0.5);
        const indice = encoderApparence(apparenceAuHasard(hasard));
        dessinerApparence(
          contexte,
          couches,
          indice,
          centre - CELLULE_APPARENCE.largeur / 2,
          pieds - CELLULE_APPARENCE.hauteur - Math.round(hasard()),
        );
      }
    }
    contexte.restore();
  }
}
