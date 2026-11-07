import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESSOIRES,
  COUPES,
  COULEURS_CHEVEUX,
  COULEURS_VETEMENTS,
  couchesApparence,
  decoderApparence,
  HAUTS,
  TEINTS,
  type DescriptionAtlasApparence,
} from '@petit-cortege/shared';
import {
  CHEMINS_ATLAS,
  CHEMINS_PLANCHES,
  genererAtlasApparence,
  lirePng,
  paletteKenney,
  type ImageRGBA,
} from '../apparence/atlas';

const racine = join(import.meta.dirname, '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin));

let palette: Set<number>;
let atlas: ReturnType<typeof genererAtlasApparence>;
let personnages: ImageRGBA;

beforeAll(() => {
  const planches = Object.values(CHEMINS_PLANCHES).map((chemin) => lirePng(lire(chemin)));
  palette = paletteKenney(planches);
  personnages = lirePng(lire(CHEMINS_PLANCHES.personnages));
  atlas = genererAtlasApparence(personnages);
});

const pixel = (image: ImageRGBA, x: number, y: number) => {
  const i = (y * image.largeur + x) * 4;
  return [...image.donnees.subarray(i, i + 4)] as [number, number, number, number];
};

/** Pixels d'une couche de l'atlas (cellule entière), en RGBA. */
function couche(nom: string, description: DescriptionAtlasApparence = atlas.description, image = atlas.image) {
  const position = description.cadres[nom];
  if (!position) throw new Error(`couche absente : ${nom}`);
  const { largeur, hauteur } = description.cellule;
  const pixels: number[][] = [];
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) pixels.push(pixel(image, position[0] + x, position[1] + y));
  return pixels;
}

/** Tuile 16 × 16 de la planche Kenney, placée comme dans une cellule de l'atlas. */
function tuileKenneyDansCellule(colonne: number, rangee: number, description = atlas.description) {
  const { largeur, hauteur, origineTuile } = description.cellule;
  const pixels: number[][] = [];
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const tx = x - origineTuile[0];
      const ty = y - origineTuile[1];
      const dedans = tx >= 0 && tx < 16 && ty >= 0 && ty < 16;
      pixels.push(dedans ? pixel(personnages, colonne * 17 + tx, rangee * 17 + ty) : [0, 0, 0, 0]);
    }
  return pixels;
}

const opaques = (pixels: number[][]) => pixels.filter((p) => p[3] !== 0).length;

describe("atlas d'apparence généré depuis la planche Kenney", () => {
  it('toutes les couleurs de sortie sont dans la palette Kenney, sans demi-transparence', () => {
    const { largeur, hauteur, donnees } = atlas.image;
    const horsPalette = new Set<string>();
    for (let i = 0; i < largeur * hauteur * 4; i += 4) {
      const alpha = donnees[i + 3]!;
      expect([0, 255]).toContain(alpha);
      if (alpha === 0) continue;
      const couleur = (donnees[i]! << 16) | (donnees[i + 1]! << 8) | donnees[i + 2]!;
      if (!palette.has(couleur)) horsPalette.add(couleur.toString(16));
    }
    expect([...horsPalette]).toEqual([]);
  });

  it("le changement de teint retrouve les corps de la planche Kenney (teints moyen et foncé d'origine)", () => {
    expect(couche(`corps/${TEINTS.findIndex((t) => t.nom === 'Moyen')}`)).toEqual(tuileKenneyDansCellule(1, 1));
    expect(couche(`corps/${TEINTS.findIndex((t) => t.nom === 'Foncé')}`)).toEqual(tuileKenneyDansCellule(1, 2));
  });

  it('le changement de couleur des cheveux retrouve les cheveux roux, blonds, noirs et blancs de la planche', () => {
    const court = COUPES.findIndex((c) => c.nom === 'Court');
    const couleur = (nom: string) => COULEURS_CHEVEUX.findIndex((c) => c.nom === nom);
    expect(couche(`cheveux/${court}/${couleur('Roux')}`)).toEqual(tuileKenneyDansCellule(23, 0));
    expect(couche(`cheveux/${court}/${couleur('Blond')}`)).toEqual(tuileKenneyDansCellule(19, 4));
    expect(couche(`cheveux/${court}/${couleur('Noir')}`)).toEqual(tuileKenneyDansCellule(23, 4));
    expect(couche(`cheveux/${court}/${couleur('Blanc')}`)).toEqual(tuileKenneyDansCellule(19, 8));
  });

  it('chaque couleur de vêtement donne un haut différent, de même silhouette que la pièce Kenney', () => {
    const tee = HAUTS.findIndex((h) => h.nom === 'Tee-shirt');
    const silhouette = (pixels: number[][]) => pixels.map((p) => p[3]);
    const variantes = COULEURS_VETEMENTS.map((_c, i) => couche(`haut/${tee}/${i}`));
    for (const v of variantes) expect(silhouette(v)).toEqual(silhouette(tuileKenneyDansCellule(8, 2)));
    expect(new Set(variantes.map((v) => JSON.stringify(v))).size).toBe(COULEURS_VETEMENTS.length);
  });

  it('les accessoires inclusifs sont dessinés (fauteuil roulant, poussette, canne)', () => {
    ACCESSOIRES.forEach((accessoire, a) => {
      if (a === 0) return;
      const dessines = opaques(couche(`accessoire/${a}/arriere`)) + opaques(couche(`accessoire/${a}/avant`));
      expect(dessines, accessoire.nom).toBeGreaterThan(12);
    });
  });

  it('chaque apparence du catalogue trouve toutes ses couches dans l’atlas', () => {
    for (let a = 0; a < ACCESSOIRES.length; a++)
      for (let coupe = 0; coupe < COUPES.length; coupe++)
        for (let haut = 0; haut < HAUTS.length; haut++) {
          const apparence = { teint: 5, couleurCheveux: 6, coupe, haut, couleurHaut: 12, couleurBas: 12, accessoire: a };
          for (const nom of couchesApparence(apparence)) expect(atlas.description.cadres, nom).toHaveProperty([nom]);
        }
    expect(decoderApparence(0)).not.toBeNull();
  });

  it('la génération est déterministe et l’atlas commité est à jour (npm run generer-apparence)', () => {
    const encore = genererAtlasApparence(personnages);
    expect(Buffer.from(encore.png).equals(Buffer.from(atlas.png))).toBe(true);
    expect(encore.json).toBe(atlas.json);
    expect(lire(CHEMINS_ATLAS.png).equals(Buffer.from(atlas.png))).toBe(true);
    expect(lire(CHEMINS_ATLAS.json).toString('utf8')).toBe(atlas.json);
  });
});
