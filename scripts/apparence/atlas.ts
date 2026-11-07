/**
 * Génération de l'atlas des couches d'apparence (ADR 0006 : rien n'est dessiné à la main).
 *
 * - Teints, couleurs de cheveux et de vêtements : **changement de palette** des pièces
 *   Kenney de la liste blanche (catalogue partagé) ; chaque couleur d'origine d'une pièce
 *   est remplacée par la couleur de même rang de la rampe choisie.
 * - Accessoires inclusifs (fauteuil roulant, poussette, canne) : **dessin procédural** en
 *   code (disques, segments, rectangles, contour sombre automatique), couleurs prises dans
 *   la palette Kenney.
 *
 * Pur et déterministe : mêmes planches → mêmes octets (PNG et JSON).
 */
import { PNG } from 'pngjs';
import {
  ACCESSOIRES,
  COUPES,
  COULEURS_CHEVEUX,
  COULEURS_VETEMENTS,
  HAUTS,
  TEINTS,
  TUILE_BAS,
  TUILE_CHAUSSURES,
  TUILE_CORPS,
  VERSION_CATALOGUE_APPARENCE,
  type DescriptionAtlasApparence,
  type TuileKenney,
} from '@petit-cortege/shared';

export interface ImageRGBA {
  largeur: number;
  hauteur: number;
  /** RGBA, 4 octets par pixel, ligne par ligne. */
  donnees: Uint8Array;
}

/** Planches Kenney (CC0) du dépôt, depuis la racine. */
export const CHEMINS_PLANCHES = {
  personnages: 'assets/kenney/chars/Spritesheet/roguelikeChar_transparent.png',
  ville: 'assets/kenney/city/Spritesheet/roguelikeCity_transparent.png',
  rpg: 'assets/kenney/rpg/Spritesheet/roguelikeSheet_transparent.png',
} as const;

/** Atlas généré, commité dans le client, depuis la racine. */
export const CHEMINS_ATLAS = {
  png: 'client/src/assets/apparence/couches.png',
  json: 'client/src/assets/apparence/couches.json',
} as const;

const TUILE = 16;
const PAS_PLANCHE = TUILE + 1; // marge de 1 px entre les tuiles Kenney
const CELLULE = { largeur: 24, hauteur: 16, origineTuile: [4, 0] as const };
const COLONNES_ATLAS = 16;
const MAGENTA = 0xff00ff;

export function lirePng(octets: Uint8Array): ImageRGBA {
  const png = PNG.sync.read(Buffer.from(octets));
  return { largeur: png.width, hauteur: png.height, donnees: new Uint8Array(png.data) };
}

export function ecrirePng(image: ImageRGBA): Uint8Array {
  const png = new PNG({ width: image.largeur, height: image.hauteur });
  png.data = Buffer.from(image.donnees);
  // Options fixées : sortie identique d'une génération à l'autre.
  return new Uint8Array(PNG.sync.write(png, { colorType: 6, deflateLevel: 9, filterType: 4 }));
}

/** Couleurs opaques (`0xRRGGBB`) de toutes les planches : la palette Kenney. */
export function paletteKenney(planches: readonly ImageRGBA[]): Set<number> {
  const palette = new Set<number>();
  for (const { donnees } of planches) {
    for (let i = 0; i < donnees.length; i += 4) {
      if (donnees[i + 3] === 0) continue;
      const couleur = (donnees[i]! << 16) | (donnees[i + 1]! << 8) | donnees[i + 2]!;
      if (couleur !== MAGENTA) palette.add(couleur);
    }
  }
  return palette;
}

// ---------------------------------------------------------------------------------------
// Toile : une cellule de l'atlas, en couleurs 0xRRGGBB (null = transparent).

class Toile {
  readonly pixels: (number | null)[] = new Array(CELLULE.largeur * CELLULE.hauteur).fill(null);

  lire(x: number, y: number): number | null {
    if (x < 0 || y < 0 || x >= CELLULE.largeur || y >= CELLULE.hauteur) return null;
    return this.pixels[y * CELLULE.largeur + x]!;
  }

  point(x: number, y: number, couleur: number): void {
    if (x < 0 || y < 0 || x >= CELLULE.largeur || y >= CELLULE.hauteur) return;
    this.pixels[y * CELLULE.largeur + x] = couleur;
  }

  rectangle(x0: number, y0: number, x1: number, y1: number, couleur: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.point(x, y, couleur);
  }

  /** Disque de centre (cx, cy) (demi-pixels permis) et de rayon r. */
  disque(cx: number, cy: number, r: number, couleur: number): void {
    for (let y = 0; y < CELLULE.hauteur; y++)
      for (let x = 0; x < CELLULE.largeur; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.point(x, y, couleur);
  }

  /** Segment de Bresenham. */
  segment(x0: number, y0: number, x1: number, y1: number, couleur: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let erreur = dx + dy;
    for (;;) {
      this.point(x0, y0, couleur);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * erreur;
      if (e2 >= dy) {
        erreur += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        erreur += dx;
        y0 += sy;
      }
    }
  }

  /** Contour sombre d'un pixel autour de tout ce qui est dessiné (style Kenney). */
  contourner(couleur: number): void {
    const avant = [...this.pixels];
    const plein = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < CELLULE.largeur && y < CELLULE.hauteur && avant[y * CELLULE.largeur + x] !== null;
    for (let y = 0; y < CELLULE.hauteur; y++)
      for (let x = 0; x < CELLULE.largeur; x++)
        if (!plein(x, y) && (plein(x - 1, y) || plein(x + 1, y) || plein(x, y - 1) || plein(x, y + 1)))
          this.point(x, y, couleur);
  }
}

// ---------------------------------------------------------------------------------------
// Changement de palette des pièces Kenney.

/** Lit une tuile de la planche des personnages, placée dans une cellule. */
function tuileKenney(planche: ImageRGBA, [colonne, rangee]: TuileKenney): Toile {
  const toile = new Toile();
  for (let y = 0; y < TUILE; y++)
    for (let x = 0; x < TUILE; x++) {
      const i = ((rangee * PAS_PLANCHE + y) * planche.largeur + colonne * PAS_PLANCHE + x) * 4;
      if (planche.donnees[i + 3] === 0) continue;
      const couleur = (planche.donnees[i]! << 16) | (planche.donnees[i + 1]! << 8) | planche.donnees[i + 2]!;
      toile.point(CELLULE.origineTuile[0] + x, CELLULE.origineTuile[1] + y, couleur);
    }
  return toile;
}

/**
 * Rampe d'origine de chaque famille de pièces : couleur Kenney → rang dans la rampe cible.
 * Les autres couleurs (bouche, cuir, chemise blanche…) sont gardées telles quelles.
 */
const RANGS_PEAU = new Map([
  [0xa17d52, 0],
  [0xaa8f6f, 0],
  [0xe5c49d, 1],
]);
const RANGS_CHEVEUX = new Map([
  [0x725839, 0],
  [0xa17d52, 1],
]);
const RANGS_VETEMENTS = new Map([
  [0xa35422, 0],
  [0xb15c23, 0],
  [0xc66527, 1],
  [0xc96827, 1],
  [0xd66f29, 1],
  [0xd97a3c, 2],
]);

function changerPalette(toile: Toile, rangs: Map<number, number>, rampe: readonly number[]): Toile {
  const resultat = new Toile();
  toile.pixels.forEach((c, i) => {
    const rang = c === null ? undefined : rangs.get(c);
    resultat.pixels[i] = rang === undefined ? c : rampe[Math.min(rang, rampe.length - 1)]!;
  });
  return resultat;
}

// ---------------------------------------------------------------------------------------
// Accessoires inclusifs, dessinés en code. Cellule 24 × 16, corps Kenney en x 4-19.

const KENNEY = {
  contour: 0x404040,
  pneu: 0x3c3c3c,
  metal: 0x8c8f93,
  metalClair: 0xc0c3c8,
  bois: 0xa17d52,
  boisSombre: 0x725839,
  capote: 0x2e8d89,
  capoteSombre: 0x1f6360,
  capoteClaire: 0x37aaa5,
} as const;

interface DessinAccessoire {
  arriere: Toile;
  avant: Toile;
}

/** Roue vue de face : pneu sombre, jante claire, moyeu. */
function roue(toile: Toile, cx: number, cy: number, rayon: number): void {
  toile.disque(cx, cy, rayon, KENNEY.pneu);
  if (rayon >= 2.5) toile.disque(cx, cy, rayon - 1.2, KENNEY.metalClair);
  toile.point(Math.round(cx), Math.round(cy), KENNEY.metal);
}

function fauteuilRoulant(): DessinAccessoire {
  // Arrière : dossier et poignées de poussée qui dépassent derrière les épaules.
  const arriere = new Toile();
  arriere.rectangle(5, 6, 5, 11, KENNEY.metal);
  arriere.rectangle(18, 6, 18, 11, KENNEY.metal);
  arriere.rectangle(4, 6, 5, 6, KENNEY.pneu);
  arriere.rectangle(18, 6, 19, 6, KENNEY.pneu);
  // Avant : grandes roues de chaque côté, accoudoirs, repose-pieds et petites roues.
  const avant = new Toile();
  roue(avant, 2.5, 12, 3.5);
  roue(avant, 20.5, 12, 3.5);
  avant.rectangle(7, 15, 9, 15, KENNEY.metal);
  avant.rectangle(14, 15, 16, 15, KENNEY.metal);
  avant.contourner(KENNEY.contour);
  return { arriere: contourne(arriere), avant };
}

function poussette(): DessinAccessoire {
  // Devant, côté droit : capote arrondie, nacelle, roues, guidon tenu à la main.
  const avant = new Toile();
  avant.segment(18, 9, 21, 7, KENNEY.metal);
  avant.disque(19.5, 11, 3.6, KENNEY.capote);
  avant.rectangle(16, 11, 23, 12, KENNEY.capoteClaire);
  avant.rectangle(16, 13, 22, 13, KENNEY.capoteSombre);
  roue(avant, 17, 15, 1);
  roue(avant, 22, 15, 1);
  avant.contourner(KENNEY.contour);
  return { arriere: new Toile(), avant };
}

function canne(): DessinAccessoire {
  // Devant, côté droit : poignée recourbée dans la main, fût en bois jusqu'au sol.
  const avant = new Toile();
  avant.rectangle(18, 9, 21, 9, KENNEY.bois);
  avant.rectangle(21, 10, 21, 14, KENNEY.bois);
  avant.point(21, 15, KENNEY.boisSombre);
  avant.contourner(KENNEY.contour);
  return { arriere: new Toile(), avant };
}

function contourne(toile: Toile): Toile {
  toile.contourner(KENNEY.contour);
  return toile;
}

const DESSINS_ACCESSOIRES: Record<string, () => DessinAccessoire> = {
  'Fauteuil roulant': fauteuilRoulant,
  Poussette: poussette,
  Canne: canne,
};

// ---------------------------------------------------------------------------------------
// Assemblage de l'atlas.

export interface AtlasApparence {
  image: ImageRGBA;
  description: DescriptionAtlasApparence;
  /** Fichiers à écrire, octet pour octet. */
  png: Uint8Array;
  json: string;
}

/** Toutes les couches du catalogue, par nom (ordre fixe : déterminisme). */
function couches(planche: ImageRGBA): [string, Toile][] {
  const liste: [string, Toile][] = [];
  const corps = tuileKenney(planche, TUILE_CORPS);
  TEINTS.forEach((t, i) => liste.push([`corps/${i}`, changerPalette(corps, RANGS_PEAU, t.rampe)]));
  const bas = tuileKenney(planche, TUILE_BAS);
  COULEURS_VETEMENTS.forEach((c, i) => liste.push([`bas/${i}`, changerPalette(bas, RANGS_VETEMENTS, c.rampe)]));
  liste.push(['chaussures', tuileKenney(planche, TUILE_CHAUSSURES)]);
  HAUTS.forEach((haut, h) => {
    const piece = tuileKenney(planche, haut.tuile!);
    COULEURS_VETEMENTS.forEach((c, i) => liste.push([`haut/${h}/${i}`, changerPalette(piece, RANGS_VETEMENTS, c.rampe)]));
  });
  COUPES.forEach((coupe, k) => {
    if (!coupe.tuile) return;
    const piece = tuileKenney(planche, coupe.tuile);
    COULEURS_CHEVEUX.forEach((c, i) => liste.push([`cheveux/${k}/${i}`, changerPalette(piece, RANGS_CHEVEUX, c.rampe)]));
  });
  ACCESSOIRES.forEach((accessoire, a) => {
    if (a === 0) return;
    const dessiner = DESSINS_ACCESSOIRES[accessoire.nom];
    if (!dessiner) throw new Error(`accessoire sans dessin : ${accessoire.nom}`);
    const { arriere, avant } = dessiner();
    liste.push([`accessoire/${a}/arriere`, arriere], [`accessoire/${a}/avant`, avant]);
  });
  return liste;
}

export function genererAtlasApparence(planchePersonnages: ImageRGBA): AtlasApparence {
  const liste = couches(planchePersonnages);
  const rangees = Math.ceil(liste.length / COLONNES_ATLAS);
  const image: ImageRGBA = {
    largeur: COLONNES_ATLAS * CELLULE.largeur,
    hauteur: rangees * CELLULE.hauteur,
    donnees: new Uint8Array(COLONNES_ATLAS * CELLULE.largeur * rangees * CELLULE.hauteur * 4),
  };
  const cadres: Record<string, [number, number]> = {};
  liste.forEach(([nom, toile], n) => {
    const ox = (n % COLONNES_ATLAS) * CELLULE.largeur;
    const oy = Math.floor(n / COLONNES_ATLAS) * CELLULE.hauteur;
    cadres[nom] = [ox, oy];
    toile.pixels.forEach((c, i) => {
      if (c === null) return;
      const x = ox + (i % CELLULE.largeur);
      const y = oy + Math.floor(i / CELLULE.largeur);
      image.donnees.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], (y * image.largeur + x) * 4);
    });
  });
  const description: DescriptionAtlasApparence = { version: VERSION_CATALOGUE_APPARENCE, cellule: CELLULE, cadres };
  return { image, description, png: ecrirePng(image), json: `${JSON.stringify(description, null, 1)}\n` };
}
