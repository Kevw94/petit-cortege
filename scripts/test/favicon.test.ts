import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lirePng } from '../apparence/atlas';
import { CHEMINS_FAVICON, COULEUR_PAPIER, genererFavicon } from '../favicon/favicon';

const racine = join(import.meta.dirname, '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin));
const egaux = (a: Uint8Array | string, b: Uint8Array | string) => Buffer.from(a).equals(Buffer.from(b));

describe('favicon', () => {
  const favicon = genererFavicon();

  it('est déterministe, et les fichiers commités sont à jour (npm run generer-favicon)', () => {
    const encore = genererFavicon();
    expect(encore.svg).toBe(favicon.svg);
    expect(egaux(encore.png32, favicon.png32)).toBe(true);
    expect(egaux(encore.ico, favicon.ico)).toBe(true);
    expect(egaux(encore.apple, favicon.apple)).toBe(true);
    expect(CHEMINS_FAVICON.svg).toBe('client/public/favicon.svg');
    expect(lire(CHEMINS_FAVICON.svg).toString('utf8')).toBe(favicon.svg);
    expect(egaux(lire(CHEMINS_FAVICON.png32), favicon.png32)).toBe(true);
    expect(egaux(lire(CHEMINS_FAVICON.ico), favicon.ico)).toBe(true);
    expect(egaux(lire(CHEMINS_FAVICON.apple), favicon.apple)).toBe(true);
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

  it("le .ico contient un PNG 32 × 32 derrière un en-tête ICO valide", () => {
    const ico = lire(CHEMINS_FAVICON.ico);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7]]).toEqual([32, 32]);
    const taille = ico.readUInt32LE(14);
    const decalage = ico.readUInt32LE(18);
    expect(decalage + taille).toBe(ico.length);
    expect(egaux(ico.subarray(decalage), lire(CHEMINS_FAVICON.png32))).toBe(true);
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
