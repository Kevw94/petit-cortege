/**
 * Plan de la ville (couche `alentours`, résolution réduite) : une texture cuite une fois, un
 * pixel par case, de la couleur moyenne de sa tuile Kenney ; chaque îlot prend l'une des
 * teintes de la carte (toits, cours : comme la bande vue de loin). Vers le bord du plan, tout
 * se fond dans la teinte du sol au-delà (`COULEUR_FOND`) : pas de bord net entre le plan et
 * le vide. Au dézoom maximal centré sur le parcours, ce bord est hors champ.
 */
import { FONDU_PLAN_M, METRES_PAR_TUILE, type AlentoursDecor, type Decor } from '@petit-cortege/shared';
import { couleursDeTuiles, type ImagesTilesets } from './cuisson';

/**
 * Teinte du sol au-delà du plan (vue déplacée loin du parcours) : couleur moyenne de la tuile
 * Kenney du toit beige plein (Roguelike Modern City, colonne 30, rangée 0), celle des îlots
 * des cartes de version 2.
 */
export const COULEUR_FOND = 0xc1b191;
export const COULEUR_FOND_CSS = `#${COULEUR_FOND.toString(16).padStart(6, '0')}`;
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

/**
 * Numéro de teinte de chaque case d'îlot (gid `gidIlot`) : les cases d'îlot contiguës (4
 * voisines) forment un îlot, qui prend la teinte `hachage(première case) mod nbTeintes` ;
 * -1 ailleurs. Coût linéaire (parcours en largeur, pile explicite).
 */
export function teintesDesIlots(gids: Uint32Array, largeur: number, gidIlot: number, nbTeintes: number): Int8Array {
  const teintes = new Int8Array(gids.length).fill(-1);
  const pile = new Int32Array(gids.length);
  for (let depart = 0; depart < gids.length; depart++) {
    if (gids[depart] !== gidIlot || teintes[depart] !== -1) continue;
    const t = Math.imul(depart + 1, 0x9e3779b1) >>> 0;
    const teinte = ((t ^ (t >>> 15)) >>> 0) % nbTeintes;
    let n = 0;
    pile[n++] = depart;
    teintes[depart] = teinte;
    while (n > 0) {
      const i = pile[--n]!;
      const x = i % largeur;
      // Les quatre voisines, sans tableau intermédiaire (plus d'un million de cases pour Paris).
      for (let v = 0; v < 4; v++) {
        const j = v === 0 ? (x > 0 ? i - 1 : -1) : v === 1 ? (x < largeur - 1 ? i + 1 : -1) : v === 2 ? i - largeur : i + largeur;
        if (j < 0 || j >= gids.length || gids[j] !== gidIlot || teintes[j] !== -1) continue;
        teintes[j] = teinte;
        pile[n++] = j;
      }
    }
  }
  return teintes;
}

/** Largeur du fondu au bord du plan, en cases. */
export const fonduEnCases = (a: Pick<AlentoursDecor, 'tuilesParCase'>) => FONDU_PLAN_M / (a.tuilesParCase * METRES_PAR_TUILE);

/** Part de la couleur propre d'une case (0 : teinte du fond, 1 : sa couleur), selon sa distance au vide. */
export function partDeLaCase(distance: number, fondu: number): number {
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
  const debut = performance.now();
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
  const fondu = fonduEnCases(a);
  const fond = [(COULEUR_FOND >> 16) & 0xff, (COULEUR_FOND >> 8) & 0xff, COULEUR_FOND & 0xff];
  const teintes = a.teintesIlots ?? [];
  const parIlot = teintes.length > 1 ? teintesDesIlots(a.gids, a.largeur, teintes[0]!, teintes.length) : null;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = y * pas * a.largeur + x * pas;
      const teinte = parIlot ? parIlot[i]! : -1;
      const c = couleur(teinte >= 0 ? teintes[teinte]! : a.gids[i]!);
      const k = c[3] ? partDeLaCase(distances[i]!, fondu) : 0;
      const o = (y * largeur + x) * 4;
      for (let v = 0; v < 3; v++) pixels.data[o + v] = Math.round(fond[v]! + (c[v]! - fond[v]!) * k);
      pixels.data[o + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  // Mesure de la cuisson (outils de développement, onglet Performance). Les navigateurs
  // anciens refusent cette forme de `measure` : la mesure ne doit jamais empêcher le décor.
  try {
    performance.measure('cuisson-plan-ville', { start: debut });
  } catch {
    // Pas de mesure sur ce navigateur.
  }
  const m = a.tuilesParCase * METRES_PAR_TUILE;
  return { canvas, x: a.x * m, y: a.y * m, largeur: largeur * pas * m, hauteur: hauteur * pas * m };
}

/** Rectangle en mètres (depuis l'origine du décor). */
export interface RectangleM {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Partie du plan qui reste nette : rectangle englobant des cases non vides, moins le fondu
 * (null : pas de plan). La vue 2D borne son dézoom pour ne pas en sortir.
 */
export function rectangleNetDuPlan(a: AlentoursDecor | undefined): RectangleM | null {
  if (!a) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < a.hauteur; y++) {
    for (let x = 0; x < a.largeur; x++) {
      if (a.gids[y * a.largeur + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX) return null;
  const m = a.tuilesParCase * METRES_PAR_TUILE;
  return {
    minX: (a.x + minX) * m + FONDU_PLAN_M,
    maxX: (a.x + maxX + 1) * m - FONDU_PLAN_M,
    minY: (a.y + minY) * m + FONDU_PLAN_M,
    maxY: (a.y + maxY + 1) * m - FONDU_PLAN_M,
  };
}

/**
 * Échelle minimale (px/m) pour qu'un écran centré sur `centre` reste dans `net` ; jamais
 * au-delà de `plafond` (la vue d'ensemble doit rester possible, quitte à montrer le fond).
 */
export function echelleMinDansLePlan(
  net: RectangleM,
  centre: { x: number; y: number },
  ecran: { largeur: number; hauteur: number },
  plafond: number,
): number {
  const demiL = Math.min(centre.x - net.minX, net.maxX - centre.x);
  const demiH = Math.min(centre.y - net.minY, net.maxY - centre.y);
  if (demiL <= 0 || demiH <= 0) return plafond;
  return Math.min(Math.max(ecran.largeur / (2 * demiL), ecran.hauteur / (2 * demiH)), plafond);
}
