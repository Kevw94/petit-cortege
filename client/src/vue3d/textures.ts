/**
 * Textures de la vue 3D, toutes composées par script à partir des planches Kenney et de
 * l'atlas d'apparence (ADR 0006) : apparences précomposées, pancartes, paquets de la masse
 * de foule, tuiles de toit et de façade. Filtrage `NearestFilter` au grossissement (pixel
 * art net) ; les pancartes, qui portent du texte, sont lissées.
 */
import * as THREE from 'three';
import { decoderPancarte, encoderPancarte, TAILLE_TUILE_PX, type Decor } from '@petit-cortege/shared';
import { Emplacements } from '../apparence/affichage';
import { CELLULE_APPARENCE, dessinerApparence, URL_COUCHES_APPARENCE } from '../apparence/dessin';
import { dessinerArbres } from '../decor/arbres';
import { sourceDeTuile, type ImagesTilesets } from '../decor/cuisson';
import { dessinerPaquets, PAQUET, VARIANTES_PAQUET } from '../foule/paquets';
import { CADRE_PANCARTE_M, dessinerPancarteCanvas } from '../pancartes/canvas';

/** Cadre dans une texture : u0, v0 (haut gauche), u1, v1 (bas droite), v vers le bas. */
export type CadreUv = readonly [number, number, number, number];

export function chargerImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const image = new Image();
    image.onload = () => resoudre(image);
    image.onerror = () => rejeter(new Error(`Image introuvable : ${url}`));
    image.src = url;
  });
}

export const chargerCouchesApparence = () => chargerImage(URL_COUCHES_APPARENCE);

function textureCanvas(canvas: HTMLCanvasElement, pixelArt: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = pixelArt ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = !pixelArt;
  return t;
}

/**
 * Atlas à emplacements : chaque clé rencontrée (indice d'apparence, de pancarte) est dessinée
 * une fois dans une case ; quand tout est pris, on repart de zéro.
 */
class Atlas {
  readonly texture: THREE.CanvasTexture;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #emplacements: Emplacements;
  readonly #colonnes: number;
  readonly #case: { largeur: number; hauteur: number };
  readonly #dessiner: (ctx: CanvasRenderingContext2D, cle: number, x: number, y: number) => void;
  readonly #cadres = new Map<number, CadreUv>();
  #aEnvoyer = false;

  constructor(options: {
    largeur: number;
    hauteur: number;
    case: { largeur: number; hauteur: number };
    pixelArt: boolean;
    dessiner: (ctx: CanvasRenderingContext2D, cle: number, x: number, y: number) => void;
  }) {
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = options.largeur;
    this.#canvas.height = options.hauteur;
    this.#ctx = this.#canvas.getContext('2d')!;
    this.#ctx.imageSmoothingEnabled = false;
    this.#case = options.case;
    // Un pixel transparent entre deux cases : pas de débordement du voisin.
    this.#colonnes = Math.floor(options.largeur / (options.case.largeur + 1));
    const rangees = Math.floor(options.hauteur / (options.case.hauteur + 1));
    this.#emplacements = new Emplacements(this.#colonnes * rangees);
    this.#dessiner = options.dessiner;
    this.texture = textureCanvas(this.#canvas, options.pixelArt);
  }

  cadre(cle: number): CadreUv {
    const { numero, nouveau, reinitialise } = this.#emplacements.prendre(cle);
    if (reinitialise) {
      this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
      this.#cadres.clear();
    }
    if (nouveau) {
      const { largeur, hauteur } = this.#case;
      const x = (numero % this.#colonnes) * (largeur + 1);
      const y = Math.floor(numero / this.#colonnes) * (hauteur + 1);
      this.#ctx.clearRect(x, y, largeur, hauteur);
      this.#dessiner(this.#ctx, cle, x, y);
      const [W, H] = [this.#canvas.width, this.#canvas.height];
      this.#cadres.set(cle, [x / W, y / H, (x + largeur) / W, (y + hauteur) / H]);
      this.#aEnvoyer = true;
    }
    return this.#cadres.get(cle)!;
  }

  /** Envoie au GPU les cases dessinées depuis la dernière image. */
  actualiser(): void {
    if (!this.#aEnvoyer) return;
    this.#aEnvoyer = false;
    this.texture.needsUpdate = true;
  }
}

/** Apparences précomposées (cellule 24 × 16 px de l'atlas des couches : 3 m × 2 m). */
export function atlasApparences(couches: CanvasImageSource): Atlas {
  return new Atlas({
    largeur: 2048,
    hauteur: 1024,
    case: CELLULE_APPARENCE,
    pixelArt: true,
    dessiner: (ctx, indice, x, y) => dessinerApparence(ctx, couches, indice, x, y),
  });
}

/**
 * Pancartes de la foule, à `pxParM` pixels par mètre ; sans slogan, la clé ne compte que la
 * forme et la couleur (quelques dizaines de cases : pancartes vues de loin).
 */
export function atlasPancartes(pxParM: number, cote: number, avecSlogan = true): Atlas {
  return new Atlas({
    largeur: cote,
    hauteur: cote,
    case: { largeur: Math.ceil(CADRE_PANCARTE_M.largeur * pxParM), hauteur: Math.ceil(CADRE_PANCARTE_M.hauteur * pxParM) },
    pixelArt: false,
    dessiner: (ctx, indice, x, y) => dessinerPancarteCanvas(ctx, indice, x, y, pxParM, avecSlogan),
  });
}

/** Clé d'une pancarte vue de loin : même forme et même couleur, slogan ignoré. */
export function cleSansSlogan(indice: number): number {
  const composition = decoderPancarte(indice);
  return composition ? encoderPancarte({ ...composition, slogan: 0 }) : indice;
}

export type { Atlas };

/** Paquets de la masse de foule, côte à côte ; `cadres[v]` pour la variante v. */
export function texturePaquets(couches: CanvasImageSource): { texture: THREE.CanvasTexture; cadres: CadreUv[] } {
  const canvas = document.createElement('canvas');
  canvas.width = PAQUET.largeur * VARIANTES_PAQUET;
  canvas.height = PAQUET.hauteur;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  dessinerPaquets(ctx, couches);
  const cadres = Array.from({ length: VARIANTES_PAQUET }, (_, v): CadreUv => [v / VARIANTES_PAQUET, 0, (v + 1) / VARIANTES_PAQUET, 1]);
  return { texture: textureCanvas(canvas, true), cadres };
}

/**
 * Texture répétable composée de tuiles Kenney (une rangée de `gids`, chacune pouvant être une
 * pile de gids dessinés l'un sur l'autre) : toit, ou façade « mur + fenêtre, mur ».
 */
export function textureDeTuiles(decor: Decor, images: ImagesTilesets, gids: readonly (readonly number[])[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TAILLE_TUILE_PX * gids.length;
  canvas.height = TAILLE_TUILE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  gids.forEach((pile, i) => {
    for (const gid of pile) {
      const s = sourceDeTuile(decor.tilesets, images, gid);
      if (s) ctx.drawImage(s.image, s.sx, s.sy, TAILLE_TUILE_PX, TAILLE_TUILE_PX, i * TAILLE_TUILE_PX, 0, TAILLE_TUILE_PX, TAILLE_TUILE_PX);
    }
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Sprites d'arbres (planche RPG Kenney, voir `dessinerArbres`), avec la taille de la planche en pixels. */
export function textureArbres(planche: CanvasImageSource): { texture: THREE.CanvasTexture; largeur: number; hauteur: number } {
  const canvas = dessinerArbres(planche);
  return { texture: textureCanvas(canvas, true), largeur: canvas.width, hauteur: canvas.height };
}
