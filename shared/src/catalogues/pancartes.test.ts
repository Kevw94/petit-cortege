import { describe, expect, it } from 'vitest';
import { COULEURS_PANCARTE, decoderPancarte, encoderPancarte, FORMES_PANCARTE, SLOGANS } from './pancartes';

describe('catalogue des pancartes', () => {
  it("une pancarte composée se retrouve à l'identique depuis son indice", () => {
    const indice = encoderPancarte({ slogan: 2, couleur: 3, forme: 1 });
    expect(decoderPancarte(indice)).toMatchObject({ slogan: 2, couleur: 3, forme: 1 });
  });
});

describe('contenu du catalogue', () => {
  it('chaque combinaison slogan × couleur × forme du catalogue a son propre indice', () => {
    const indices = new Set<number>();
    SLOGANS.forEach((_s, slogan) =>
      COULEURS_PANCARTE.forEach((_c, couleur) =>
        FORMES_PANCARTE.forEach((_f, forme) => {
          const indice = encoderPancarte({ slogan, couleur, forme });
          expect(decoderPancarte(indice)).toEqual({ slogan, couleur, forme });
          indices.add(indice);
        }),
      ),
    );
    expect(indices.size).toBe(SLOGANS.length * COULEURS_PANCARTE.length * FORMES_PANCARTE.length);
  });

  it('les slogans sont assez courts pour tenir sur une pancarte', () => {
    for (const slogan of SLOGANS) expect(slogan.length).toBeLessThanOrEqual(24);
  });
});

describe('indice de pancarte', () => {
  it("l'indice est stable : couleur, forme et slogan occupent des places fixes", () => {
    // Exemple calculé à la main : couleur 2 (bits 0-3), forme 3 (bits 4-5), slogan 1 (bits 6-13).
    expect(encoderPancarte({ slogan: 1, couleur: 2, forme: 3 })).toBe(114);
    expect(decoderPancarte(0)).toEqual({ slogan: 0, couleur: 0, forme: 0 });
  });

  it.each([
    ['slogan absent du catalogue', encoderPancarte({ slogan: 255, couleur: 0, forme: 0 })],
    ['couleur absente du catalogue', 15],
    ['au-delà des champs', 1 << 14],
    ['négatif', -1],
    ['non entier', 1.5],
    ['pas un nombre', Number.NaN],
  ])('un indice qui ne désigne aucune pancarte du catalogue est refusé (%s)', (_cas, indice) => {
    expect(decoderPancarte(indice)).toBeNull();
  });
});
