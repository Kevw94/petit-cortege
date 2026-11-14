/**
 * Alentours du décor (couche `alentours`, résolution réduite) : une texture cuite une fois,
 * un pixel par case, de la couleur moyenne de sa tuile Kenney ; vers le bord des alentours,
 * les rues et les verts se fondent dans la teinte des pâtés de maisons, qui est aussi celle
 * du sol au-delà (`COULEUR_FOND`) : pas de bord net entre la carte et le vide.
 */
import { METRES_PAR_TUILE, type AlentoursDecor, type Decor } from '@petit-cortege/shared';
import { couleursDeTuiles, type ImagesTilesets } from './cuisson';

/**
 * Teinte des pâtés de maisons et du sol au-delà des alentours : couleur moyenne de la tuile
 * Kenney du toit beige plein (Roguelike Modern City, colonne 30, rangée 0), celle que le
 * générateur pose sur les îlots des alentours (`TUILES.pateDeMaisons`).
 */
export const COULEUR_FOND = 0xc1b191;
export const COULEUR_FOND_CSS = `#${COULEUR_FOND.toString(16).padStart(6, '0')}`;
/** Largeur du fondu au bord des alentours, en cases (≈ 160 m). */
export const FONDU_CASES = 40;
/** Côté maximal de la texture (WebGL des téléphones modestes : 4096). */
const COTE_TEXTURE_MAX = 4096;

/**
 * Distance (en cases, métrique de chanfrein 1 / √2) de chaque case à la case vide la plus
 * proche ; l'extérieur de la grille compte comme vide. Deux passes, coût linéaire.
 */
export function distancesAuVide(gids: Uint32Array, largeur: number, hauteur: number): Float32Array {
  const d = new Float32Array(largeur * hauteur);
  const lire = (x: number, y: number) => (x < 0 || y < 0 || x >= largeur || y >= hauteur ? 0 : d[y * largeur + x]!);
  const R2 = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = gids[i] === 0 ? 0 : Infinity;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = y * largeur + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, lire(x - 1, y) + 1, lire(x, y - 1) + 1, lire(x - 1, y - 1) + R2, lire(x + 1, y - 1) + R2);
    }
  }
  for (let y = hauteur - 1; y >= 0; y--) {
    for (let x = largeur - 1; x >= 0; x--) {
      const i = y * largeur + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, lire(x + 1, y) + 1, lire(x, y + 1) + 1, lire(x + 1, y + 1) + R2, lire(x - 1, y + 1) + R2);
    }
  }
  return d;
}

/** Part de la couleur propre d'une case (0 : teinte du fond, 1 : sa couleur), selon sa distance au vide. */
export function partDeLaCase(distance: number, fondu = FONDU_CASES): number {
  const u = Math.min(Math.max(distance / fondu, 0), 1);
  return u * u * (3 - 2 * u);
}

export interface AlentoursCuits {
  canvas: HTMLCanvasElement;
  /** Rectangle couvert, en mètres depuis l'origine du décor. */
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Cuit la texture des alentours (null : décor ancien, sans alentours). */
export function cuireAlentours(decor: Decor, images: ImagesTilesets): AlentoursCuits | null {
  const a: AlentoursDecor | undefined = decor.alentours;
  if (!a) return null;
  const pas = Math.ceil(Math.max(a.largeur, a.hauteur) / COTE_TEXTURE_MAX);
  const largeur = Math.ceil(a.largeur / pas);
  const hauteur = Math.ceil(a.hauteur / pas);
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(largeur, hauteur);
  const couleur = couleursDeTuiles(decor.tilesets, images);
  const distances = distancesAuVide(a.gids, a.largeur, a.hauteur);
  const fond = [(COULEUR_FOND >> 16) & 0xff, (COULEUR_FOND >> 8) & 0xff, COULEUR_FOND & 0xff];
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = y * pas * a.largeur + x * pas;
      const c = couleur(a.gids[i]!);
      const k = c[3] ? partDeLaCase(distances[i]!) : 0;
      const o = (y * largeur + x) * 4;
      for (let v = 0; v < 3; v++) pixels.data[o + v] = Math.round(fond[v]! + (c[v]! - fond[v]!) * k);
      pixels.data[o + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const m = a.tuilesParCase * METRES_PAR_TUILE;
  return { canvas, x: a.x * m, y: a.y * m, largeur: largeur * pas * m, hauteur: hauteur * pas * m };
}
