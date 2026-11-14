/**
 * Favicon du site : un petit personnage qui tient une pancarte vide, en pixels (grille de
 * 16 × 16, même esprit que le bandeau de l'accueil). Rien de dessiné à la main (ADR 0006) :
 * la grille est du code, les couleurs viennent de la palette du jeu (teint du catalogue
 * d'apparence, couleur de vêtement des pancartes du catalogue, papier `#f4f1ea`). Aucune
 * couleur, texte ou symbole d'un camp (ADR 0003) : pancarte unie, blanc cassé, contour sombre.
 *
 * Pur et déterministe : mêmes entrées → mêmes octets. Régénérer avec `npm run generer-favicon` ;
 * les sorties sont commitées dans `client/public/`.
 */
import { COULEURS_PANCARTE, TEINTS } from '@petit-cortege/shared';
import { ecrirePng, type ImageRGBA } from '../apparence/atlas';

/** Sorties publiées, depuis la racine ; servies à `/favicon.svg`, etc. (balises de `client/index.html`). */
export const CHEMINS_FAVICON = {
  svg: 'client/public/favicon.svg',
  png32: 'client/public/favicon-32.png',
  ico: 'client/public/favicon.ico',
  apple: 'client/public/apple-touch-icon.png',
} as const;

export const COULEUR_PAPIER = 0xf4f1ea;

const TAILLE = 16;
const TAILLE_APPLE = 180;

/** Légende de la grille : `.` = transparent. */
const GRILLE = [
  '................',
  '..oooooooooooo..',
  '..owwwwwwwwwwo..',
  '..owwwwwwwwwwo..',
  '..owwwwwwwwwwo..',
  '..owwwwwwwwwwo..',
  '..oooooooooooo..',
  '.....hhhh.m.....',
  '.....hssh.m.....',
  '.....ssss.m.....',
  '....vvvvvvm.....',
  '....vvvvvss.....',
  '....vvvvvv......',
  '....vvvvvv......',
  '.....jj.jj......',
  '.....jj.jj......',
] as const;

const COULEUR_CONTOUR = 0x3a3a3a;
const COULEUR_PANNEAU = 0xfffdf7;
const COULEUR_MANCHE = 0x7a5530; // comme les pancartes du jeu et du bandeau
const COULEUR_CHEVEUX = 0x4a3426;
const COULEUR_JAMBES = 0x3a3a3a;

function palette(): Record<string, number> {
  return {
    o: COULEUR_CONTOUR,
    w: COULEUR_PANNEAU,
    m: COULEUR_MANCHE,
    h: COULEUR_CHEVEUX,
    s: TEINTS[2]!.rampe[1]!, // teint du catalogue d'apparence
    v: COULEURS_PANCARTE.find((c) => c.nom === 'turquoise')!.fond, // vêtement : couleur du catalogue, sobre
    j: COULEUR_JAMBES,
  };
}

const enCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Pixels de l'icône : 16 × 16, `null` = transparent. */
export function pixelsFavicon(): (number | null)[][] {
  const p = palette();
  return GRILLE.map((ligne) => [...ligne].map((c) => (c === '.' ? null : p[c]!)));
}

/** SVG net (`crispEdges`), un rectangle par suite de pixels de même couleur. */
export function svgFavicon(): string {
  const rects: string[] = [];
  pixelsFavicon().forEach((ligne, y) => {
    let x = 0;
    while (x < TAILLE) {
      const c = ligne[x];
      if (c === null || c === undefined) {
        x++;
        continue;
      }
      const debut = x;
      while (ligne[x] === c) x++;
      rects.push(`<rect x="${debut}" y="${y}" width="${x - debut}" height="1" fill="${enCss(c)}"/>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TAILLE} ${TAILLE}" width="${TAILLE}" height="${TAILLE}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

/** Image agrandie au plus proche voisin, centrée (marge autour), sur fond transparent ou papier. */
function rendre(taille: number, echelle: number, fond: number | null): ImageRGBA {
  const donnees = new Uint8Array(taille * taille * 4);
  if (fond !== null)
    for (let i = 0; i < taille * taille; i++) donnees.set([fond >> 16, (fond >> 8) & 0xff, fond & 0xff, 255], i * 4);
  const cote = TAILLE * echelle;
  const decalage = Math.floor((taille - cote) / 2);
  const pixels = pixelsFavicon();
  for (let y = 0; y < cote; y++)
    for (let x = 0; x < cote; x++) {
      const c = pixels[Math.floor(y / echelle)]![Math.floor(x / echelle)];
      if (c === null || c === undefined) continue;
      donnees.set([c >> 16, (c >> 8) & 0xff, c & 0xff, 255], ((decalage + y) * taille + decalage + x) * 4);
    }
  return { largeur: taille, hauteur: taille, donnees };
}

/** `.ico` à une image : en-tête ICONDIR + une entrée ICONDIRENTRY autour du PNG. */
export function icoDepuisPng(png: Uint8Array, taille: number): Uint8Array {
  const sortie = Buffer.alloc(22 + png.length);
  sortie.writeUInt16LE(0, 0); // réservé
  sortie.writeUInt16LE(1, 2); // type : icône
  sortie.writeUInt16LE(1, 4); // une image
  sortie.writeUInt8(taille >= 256 ? 0 : taille, 6);
  sortie.writeUInt8(taille >= 256 ? 0 : taille, 7);
  sortie.writeUInt8(0, 8); // pas de palette
  sortie.writeUInt8(0, 9);
  sortie.writeUInt16LE(1, 10); // plans
  sortie.writeUInt16LE(32, 12); // bits par pixel
  sortie.writeUInt32LE(png.length, 14);
  sortie.writeUInt32LE(22, 18); // décalage des données
  sortie.set(png, 22);
  return new Uint8Array(sortie);
}

export interface SortiesFavicon {
  svg: string;
  png32: Uint8Array;
  ico: Uint8Array;
  apple: Uint8Array;
  /** Images décodables telles que publiées, pour les tests. */
  imagePng32: ImageRGBA;
  imageApple: ImageRGBA;
}

export function genererFavicon(): SortiesFavicon {
  const imagePng32 = rendre(32, 2, null);
  // Icône Apple : fond papier opaque, personnage × 8 (128 px) centré : marge de 26 px.
  const imageApple = rendre(TAILLE_APPLE, 8, COULEUR_PAPIER);
  const png32 = ecrirePng(imagePng32);
  return { svg: svgFavicon(), png32, ico: icoDepuisPng(png32, 32), apple: ecrirePng(imageApple), imagePng32, imageApple };
}
