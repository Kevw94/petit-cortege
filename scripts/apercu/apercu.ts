/**
 * Image d'aperçu de lien (Open Graph, Twitter), unique pour tout le site (ADR 0002) :
 * une rue de ville Kenney remplie d'un cortège générique, 1200 × 630 (400 × 210 px de
 * tuiles 16 px, agrandis × 3 au plus proche voisin). Rien de dessiné à la main (ADR 0006) :
 * tuiles des planches Kenney, avatars de l'atlas d'apparence, pancartes du catalogue
 * dessinées comme dans le jeu (panneau coloré sur un manche).
 *
 * Pure et déterministe (graine fixe) : mêmes planches → mêmes octets. Régénérer avec
 * `npm run generer-apercu` ; le résultat est commité dans `client/public/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apparenceAuHasard,
  COULEURS_PANCARTE,
  couchesApparence,
  type DescriptionAtlasApparence,
} from '@petit-cortege/shared';
import { CHEMINS_ATLAS, CHEMINS_PLANCHES, ecrirePng, lirePng, type ImageRGBA } from '../apparence/atlas';

/** Image publiée, depuis la racine ; servie à `/apercu.png` (balises de `client/index.html`). */
export const CHEMIN_APERCU = 'client/public/apercu.png';

const LARGEUR = 400;
const HAUTEUR = 210;
const ECHELLE = 3;
const TUILE = 16;
const PAS = TUILE + 1; // marge de 1 px entre les tuiles Kenney
const COLONNES = Math.ceil(LARGEUR / TUILE);
const RANGEES = Math.ceil(HAUTEUR / TUILE);
const COULEUR_MANCHE = 0x7a5530;
const GRAINE = 0x2d2c7;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
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

class Toile {
  readonly donnees = new Uint8Array(LARGEUR * HAUTEUR * 4);

  /** Copie une zone d'une image (pixels opaques seulement, magenta Kenney = transparent). */
  coller(source: ImageRGBA, sx: number, sy: number, l: number, h: number, x: number, y: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < l; i++) {
        const dx = x + i;
        const dy = y + j;
        if (dx < 0 || dy < 0 || dx >= LARGEUR || dy >= HAUTEUR) continue;
        const s = ((sy + j) * source.largeur + sx + i) * 4;
        const [r, g, b, a] = [
          source.donnees[s]!,
          source.donnees[s + 1]!,
          source.donnees[s + 2]!,
          source.donnees[s + 3]!,
        ];
        if (a < 128 || (r === 255 && g === 0 && b === 255)) continue;
        this.donnees.set([r, g, b, 255], (dy * LARGEUR + dx) * 4);
      }
  }

  rectangle(x0: number, y0: number, x1: number, y1: number, couleur: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= LARGEUR || y >= HAUTEUR) continue;
        this.donnees.set([couleur >> 16, (couleur >> 8) & 0xff, couleur & 0xff, 255], (y * LARGEUR + x) * 4);
      }
  }

  agrandie(): ImageRGBA {
    const largeur = LARGEUR * ECHELLE;
    const hauteur = HAUTEUR * ECHELLE;
    const donnees = new Uint8Array(largeur * hauteur * 4);
    for (let y = 0; y < hauteur; y++)
      for (let x = 0; x < largeur; x++) {
        const s = (Math.floor(y / ECHELLE) * LARGEUR + Math.floor(x / ECHELLE)) * 4;
        donnees.set(this.donnees.subarray(s, s + 4), (y * largeur + x) * 4);
      }
    return { largeur, hauteur, donnees };
  }
}

const assombrir = (couleur: number, f: number) =>
  (Math.round((couleur >> 16) * f) << 16) |
  (Math.round(((couleur >> 8) & 0xff) * f) << 8) |
  Math.round((couleur & 0xff) * f);

export function genererApercuLien(racine: string): { image: ImageRGBA; png: Uint8Array } {
  const lire = (chemin: string) => lirePng(readFileSync(join(racine, chemin)));
  const ville = lire(CHEMINS_PLANCHES.ville);
  const atlas = lire(CHEMINS_ATLAS.png);
  const description = JSON.parse(readFileSync(join(racine, CHEMINS_ATLAS.json), 'utf8')) as DescriptionAtlasApparence;
  const toile = new Toile();
  const tuile = (c: number, r: number, x: number, y: number) =>
    toile.coller(ville, c * PAS, r * PAS, TUILE, TUILE, x * TUILE, y * TUILE);

  // Sol : trottoir partout, chaussée large (rangées 7 à 11), pointillés au milieu.
  for (let y = 0; y < RANGEES; y++) for (let x = 0; x < COLONNES; x++) tuile(1, 20, x, y);
  for (let x = 0; x < COLONNES; x++) {
    for (let y = 7; y <= 11; y++) tuile(11, 19, x, y);
    if (x % 2 === 0) tuile(9, 19, x, 9);
  }

  // Immeubles : toit en 9 tranches (3 rangées), façade (3 rangées), fenêtres et porte.
  const immeuble = (x0: number, l: number, toitC0: number, murC0: number) => {
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < l; x++) {
        const cx = x === 0 ? 0 : x === l - 1 ? 1 : 2;
        const [c, r] = (
          y === 0
            ? [
                [0, 0],
                [1, 0],
                [2, 0],
              ]
            : y === 2
              ? [
                  [0, 1],
                  [1, 1],
                  [2, 1],
                ]
              : [
                  [3, 0],
                  [3, 1],
                  [2, 3],
                ]
        )[cx]!;
        tuile(toitC0 + c!, r!, x0 + x, y);
      }
    for (let x = 0; x < l; x++) {
      const c = murC0 + (x === 0 ? 0 : x === l - 1 ? 3 : 1);
      tuile(c, 4, x0 + x, 3);
      tuile(c, 9, x0 + x, 4);
      tuile(c, 10, x0 + x, 5);
    }
    for (let x = 1; x < l - 1; x += 2) tuile(25, 16, x0 + x, 4);
    const porte = x0 + Math.floor(l / 2);
    tuile(20, 26, porte, 4);
    tuile(20, 27, porte, 5);
  };
  immeuble(0, 6, 0, 0);
  immeuble(7, 5, 8, 4);
  immeuble(13, 6, 24, 8);
  immeuble(20, 5, 0, 4);
  for (const x of [6, 12, 19]) {
    tuile(1, 16, x, 3);
    tuile(1, 17, x, 4);
    tuile(1, 18, x, 5);
  }
  // Cortège : avatars de l'atlas, du fond vers l'avant, près de la moitié avec une pancarte.
  const hasard = alea(GRAINE);
  const { largeur: lc, hauteur: hc, origineTuile } = description.cellule;
  const places: { x: number; y: number }[] = [];
  for (let y = 7; y <= 11; y++)
    for (let x = 0; x < COLONNES; x++)
      if (hasard() < 0.72)
        places.push({ x: x * TUILE + Math.floor(hasard() * 7) - 3, y: y * TUILE + Math.floor(hasard() * 7) - 5 });
  places.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const { x, y } of places) {
    const pancarte = hasard() < 0.45 ? COULEURS_PANCARTE[Math.floor(hasard() * COULEURS_PANCARTE.length)]! : null;
    for (const couche of couchesApparence(apparenceAuHasard(hasard))) {
      const [ax, ay] = description.cadres[couche]!;
      toile.coller(atlas, ax, ay, lc, hc, x - origineTuile[0], y - origineTuile[1]);
    }
    if (pancarte) {
      toile.rectangle(x + 12, y - 4, x + 12, y + 8, COULEUR_MANCHE);
      toile.rectangle(x + 7, y - 10, x + 17, y - 3, assombrir(pancarte.fond, 0.6));
      toile.rectangle(x + 8, y - 9, x + 16, y - 4, pancarte.fond);
    }
  }

  const image = toile.agrandie();
  return { image, png: ecrirePng(image) };
}
