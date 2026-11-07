/**
 * Rendu des avatars en sprites, partie pure (sans Phaser) : quels avatars dessiner,
 * avec quelles couches de l'atlas, et où ranger leurs apparences précomposées.
 *
 * Technique retenue par le prototype de performance (#4) : un `Image` par avatar
 * visible, apparence précomposée dans une texture (un seul quad par avatar),
 * au plus `BUDGET_AVATARS_DESSINES` par image (au-delà : masse de foule).
 */
import { couchesApparence, decoderApparence } from '@petit-cortege/shared';

/** Budget dur d'avatars dessinés individuellement par image (docs/perf-prototype.md). */
export const BUDGET_AVATARS_DESSINES = 2000;

export interface AvatarAPlacer {
  /** Pieds de l'avatar à l'écran (pixels) : milieu du bas du sprite. */
  x: number;
  y: number;
}

export interface OptionsEcran {
  /** Écran, en pixels. */
  largeur: number;
  hauteur: number;
  /** Taille d'un sprite à l'écran, en pixels. */
  largeurSprite: number;
  hauteurSprite: number;
}

/**
 * Le sprite de l'avatar touche-t-il l'écran ? Les autres ne sont pas dessinés.
 * Le choix des avatars dessinés au-delà du budget est fait par le Cortège
 * (`composerFoule` : tirage par hachage de l'identifiant, masse de foule).
 */
export function aLEcran(
  avatar: AvatarAPlacer,
  { largeur, hauteur, largeurSprite, hauteurSprite }: OptionsEcran,
): boolean {
  const demiLargeur = largeurSprite / 2;
  return avatar.x + demiLargeur >= 0 && avatar.x - demiLargeur <= largeur && avatar.y >= 0 && avatar.y - hauteurSprite <= hauteur;
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
