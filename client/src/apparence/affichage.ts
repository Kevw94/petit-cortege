/**
 * Rendu des avatars en sprites, partie pure (sans Phaser) : quels avatars dessiner,
 * avec quelles couches de l'atlas, et où ranger leurs apparences précomposées.
 *
 * Technique retenue par le prototype de performance (#4) : un `Image` par avatar
 * visible, apparence précomposée dans une texture (un seul quad par avatar),
 * au plus `BUDGET_AVATARS_DESSINES` par image.
 */
import { couchesApparence, decoderApparence } from '@petit-cortege/shared';

/** Budget dur d'avatars dessinés individuellement par image (docs/perf-prototype.md). */
export const BUDGET_AVATARS_DESSINES = 2000;

export interface AvatarAPlacer {
  /** Pieds de l'avatar à l'écran (pixels) : milieu du bas du sprite. */
  x: number;
  y: number;
  propre: boolean;
}

export interface OptionsDessin {
  /** Écran, en pixels. */
  largeur: number;
  hauteur: number;
  /** Taille d'un sprite à l'écran, en pixels. */
  largeurSprite: number;
  hauteurSprite: number;
  budget: number;
}

/**
 * Avatars à dessiner : ceux dont le sprite touche l'écran, dans l'ordre reçu, au plus
 * `budget` pour la foule ; ses propres avatars sont toujours dessinés en plus.
 */
export function avatarsADessiner<A extends AvatarAPlacer>(
  avatars: readonly A[],
  { largeur, hauteur, largeurSprite, hauteurSprite, budget }: OptionsDessin,
): A[] {
  const demiLargeur = largeurSprite / 2;
  const dessines: A[] = [];
  let foule = 0;
  for (const avatar of avatars) {
    const aLEcran =
      avatar.x + demiLargeur >= 0 && avatar.x - demiLargeur <= largeur && avatar.y >= 0 && avatar.y - hauteurSprite <= hauteur;
    if (!aLEcran) continue;
    if (!avatar.propre) {
      if (foule >= budget) continue;
      foule++;
    }
    dessines.push(avatar);
  }
  return dessines;
}

/** Couches de l'atlas pour un indice ; un indice hors catalogue prend l'apparence par défaut. */
export function couchesPourIndice(indice: number): string[] {
  return couchesApparence(decoderApparence(indice) ?? decoderApparence(0)!);
}

/**
 * Emplacements d'une texture d'apparences précomposées : un par indice d'apparence
 * rencontré. Quand tout est pris, on repart de zéro (la texture est redessinée au fil
 * des images, seules les apparences encore à l'écran reviennent).
 */
export class Emplacements {
  readonly #capacite: number;
  readonly #numeros = new Map<number, number>();

  constructor(capacite: number) {
    this.#capacite = capacite;
  }

  prendre(indice: number): { numero: number; nouveau: boolean; reinitialise: boolean } {
    const connu = this.#numeros.get(indice);
    if (connu !== undefined) return { numero: connu, nouveau: false, reinitialise: false };
    const reinitialise = this.#numeros.size >= this.#capacite;
    if (reinitialise) this.#numeros.clear();
    const numero = this.#numeros.size;
    this.#numeros.set(indice, numero);
    return { numero, nouveau: true, reinitialise };
  }
}
