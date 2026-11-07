import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEMINS_PLANCHES, lirePng, paletteKenney } from '../apparence/atlas';
import { CHEMIN_APERCU, genererApercuLien } from '../apercu/apercu';

const racine = join(import.meta.dirname, '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin));

describe("image d'aperçu de lien (Open Graph)", () => {
  const apercu = genererApercuLien(racine);

  it('fait 1200 × 630, est déterministe, et le fichier commité est à jour (npm run generer-apercu)', () => {
    expect(apercu.image.largeur).toBe(1200);
    expect(apercu.image.hauteur).toBe(630);
    expect(Buffer.from(genererApercuLien(racine).png).equals(Buffer.from(apercu.png))).toBe(true);
    expect(CHEMIN_APERCU).toBe('client/public/apercu.png');
    expect(Buffer.from(lire(CHEMIN_APERCU)).equals(Buffer.from(apercu.png))).toBe(true);
  });

  it('est entièrement opaque (un pixel transparent devient noir dans certains aperçus)', () => {
    const { donnees } = apercu.image;
    let transparents = 0;
    for (let i = 3; i < donnees.length; i += 4) if (donnees[i] !== 255) transparents++;
    expect(transparents).toBe(0);
  });

  it('montre la ville Kenney : la plupart des couleurs viennent des planches', () => {
    const palette = paletteKenney(Object.values(CHEMINS_PLANCHES).map((c) => lirePng(lire(c))));
    const { donnees } = apercu.image;
    let kenney = 0;
    for (let i = 0; i < donnees.length; i += 4) {
      if (palette.has((donnees[i]! << 16) | (donnees[i + 1]! << 8) | donnees[i + 2]!)) kenney++;
    }
    expect(kenney / (donnees.length / 4)).toBeGreaterThan(0.6);
  });
});
