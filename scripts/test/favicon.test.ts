import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lirePng } from '../apparence/atlas';
import { CHEMINS_FAVICON, COULEUR_PAPIER, genererFavicon, pixelsFavicon } from '../favicon/favicon';

const racine = join(import.meta.dirname, '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin));
const egaux = (a: Uint8Array | string, b: Uint8Array | string) => Buffer.from(a).equals(Buffer.from(b));

/** Grille 16 × 16 répétée en blocs `echelle` × `echelle`, sans lissage (fond transparent). */
function pixelsAgrandis(echelle: number): Uint8Array {
  const taille = 16 * echelle;
  const donnees = new Uint8Array(taille * taille * 4);
  const source = pixelsFavicon();
  for (let y = 0; y < taille; y++)
    for (let x = 0; x < taille; x++) {
      const c = source[Math.floor(y / echelle)]![Math.floor(x / echelle)];
      if (c === null || c === undefined) continue;
      donnees.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], (y * taille + x) * 4);
    }
  return donnees;
}

describe('favicon', () => {
  const favicon = genererFavicon();

  it('est déterministe, et les fichiers commités sont à jour (npm run generer-favicon)', () => {
    const encore = genererFavicon();
    expect(encore.svg).toBe(favicon.svg);
    expect(egaux(encore.png32, favicon.png32)).toBe(true);
    expect(egaux(encore.png96, favicon.png96)).toBe(true);
    expect(egaux(encore.ico, favicon.ico)).toBe(true);
    expect(egaux(encore.apple, favicon.apple)).toBe(true);
    expect(CHEMINS_FAVICON.svg).toBe('client/public/favicon.svg');
    expect(lire(CHEMINS_FAVICON.svg).toString('utf8')).toBe(favicon.svg);
    expect(egaux(lire(CHEMINS_FAVICON.png32), favicon.png32)).toBe(true);
    expect(egaux(lire(CHEMINS_FAVICON.png96), favicon.png96)).toBe(true);
    expect(egaux(lire(CHEMINS_FAVICON.ico), favicon.ico)).toBe(true);
    expect(egaux(lire(CHEMINS_FAVICON.apple), favicon.apple)).toBe(true);
  });

  it('le HTML publie le PNG 96 et les trois tailles du .ico', () => {
    const html = lire('client/index.html').toString('utf8');
    expect(html).toContain('<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96" />');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />');
  });

  it('le SVG est net : 16 × 16, pixels francs, aucune ressource externe ni texte', () => {
    expect(favicon.svg).toContain('viewBox="0 0 16 16"');
    expect(favicon.svg).toContain('shape-rendering="crispEdges"');
    expect(favicon.svg).not.toMatch(/<text|<image|href=|<script|url\(/);
  });

  it('le PNG 32 px fait 32 × 32 et garde un fond transparent', () => {
    const png = lirePng(lire(CHEMINS_FAVICON.png32));
    expect({ l: png.largeur, h: png.hauteur }).toEqual({ l: 32, h: 32 });
    expect(png.donnees[3]).toBe(0); // coin haut gauche
    expect(png.donnees.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
  });

  it('le PNG 96 px est un carré RGBA, agrandi au plus proche voisin (×6), fond transparent', () => {
    const octets = lire(CHEMINS_FAVICON.png96);
    expect(octets[24]).toBe(8); // profondeur
    expect(octets[25]).toBe(6); // type de couleur : RGBA
    const png = lirePng(octets);
    expect({ l: png.largeur, h: png.hauteur }).toEqual({ l: 96, h: 96 });
    expect(Buffer.from(png.donnees).equals(pixelsAgrandis(6))).toBe(true);
  });

  it('le .ico embarque les PNG 16, 32 et 48, au plus proche voisin', () => {
    const ico = lire(CHEMINS_FAVICON.ico);
    const tailles = [16, 32, 48];
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, tailles.length]);
    let fin = 6 + 16 * tailles.length;
    tailles.forEach((taille, i) => {
      const o = 6 + 16 * i;
      expect([ico[o], ico[o + 1]]).toEqual([taille, taille]);
      expect(ico.readUInt16LE(o + 4)).toBe(1); // plans
      expect(ico.readUInt16LE(o + 6)).toBe(32); // bits par pixel
      const longueur = ico.readUInt32LE(o + 8);
      const decalage = ico.readUInt32LE(o + 12);
      expect(decalage).toBe(fin);
      fin += longueur;
      const png = ico.subarray(decalage, decalage + longueur);
      expect(png[25]).toBe(6); // RGBA
      if (taille === 32) expect(egaux(png, lire(CHEMINS_FAVICON.png32))).toBe(true);
      const image = lirePng(png);
      expect(Buffer.from(image.donnees).equals(pixelsAgrandis(taille / 16))).toBe(true);
    });
    expect(fin).toBe(ico.length);
  });

  it("l'icône Apple fait 180 × 180, est entièrement opaque, fond papier et marge de sécurité", () => {
    const png = lirePng(lire(CHEMINS_FAVICON.apple));
    expect({ l: png.largeur, h: png.hauteur }).toEqual({ l: 180, h: 180 });
    const papier = [COULEUR_PAPIER >> 16, (COULEUR_PAPIER >> 8) & 0xff, COULEUR_PAPIER & 0xff, 255];
    for (let i = 0; i < png.donnees.length; i += 4) expect(png.donnees[i + 3]).toBe(255);
    // Bande de 20 px sur chaque bord : uniquement du papier.
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 180; x++) {
        if (x >= 20 && x < 160 && y >= 20 && y < 160) continue;
        const s = (y * 180 + x) * 4;
        expect([...png.donnees.subarray(s, s + 4)]).toEqual(papier);
      }
  });
});
