import { describe, expect, it } from 'vitest';
import { encoderPancarte } from '@petit-cortege/shared';
import { pancartesAffichees, SEUIL_SLOGAN_PX_PAR_M } from './affichage';

const ECRAN = { largeur: 400, hauteur: 800 };
// Slogan 1 = « Avec vous », couleur 6 = bleu, forme 2 = rond (catalogue v1).
const AVEC_VOUS_BLEU_ROND = encoderPancarte({ slogan: 1, couleur: 6, forme: 2 });

describe('pancartes affichées', () => {
  it('de loin, une pancarte ne montre que sa couleur et sa forme', () => {
    const [pancarte] = pancartesAffichees([{ x: 200, y: 400, pancarte: AVEC_VOUS_BLEU_ROND, propre: false }], {
      ...ECRAN,
      echelle: 0.5,
    });

    expect(pancarte).toMatchObject({ forme: 'rond', couleur: { nom: 'bleu', fond: 0x3b6fc4 }, slogan: null });
  });

  it('au zoom, le slogan devient lisible', () => {
    const [pancarte] = pancartesAffichees([{ x: 200, y: 400, pancarte: AVEC_VOUS_BLEU_ROND, propre: false }], {
      ...ECRAN,
      echelle: SEUIL_SLOGAN_PX_PAR_M,
    });

    expect(pancarte?.slogan).toBe('Avec vous');
  });

  it('sur son propre avatar, le slogan est lisible même de loin', () => {
    const [autre, sienne] = pancartesAffichees(
      [
        { x: 200, y: 400, pancarte: AVEC_VOUS_BLEU_ROND, propre: false },
        { x: 210, y: 400, pancarte: AVEC_VOUS_BLEU_ROND, propre: true },
      ],
      { ...ECRAN, echelle: 0.5 },
    );

    expect(sienne?.slogan).toBe('Avec vous');
    // Assez grande pour être lue : comme une pancarte vue au zoom.
    expect(sienne?.hauteur).toBeGreaterThanOrEqual(SEUIL_SLOGAN_PX_PAR_M);
    expect(autre?.hauteur).toBeLessThan(SEUIL_SLOGAN_PX_PAR_M);
  });

  it("un avatar dont l'indice ne désigne aucune pancarte du catalogue n'en porte pas", () => {
    const affichees = pancartesAffichees([{ x: 200, y: 400, pancarte: 15, propre: false }], { ...ECRAN, echelle: 40 });

    expect(affichees).toEqual([]);
  });

  it("seules les pancartes visibles à l'écran sont à dessiner, la sienne par-dessus les autres", () => {
    const affichees = pancartesAffichees(
      [
        { x: 200, y: 400, pancarte: 0, propre: true },
        { x: -500, y: 400, pancarte: 1, propre: false },
        { x: 200, y: 2000, pancarte: 2, propre: false },
        { x: 210, y: 400, pancarte: 3, propre: false },
      ],
      { ...ECRAN, echelle: 40 },
    );

    expect(affichees.map((p) => [p.couleur.nom, p.propre])).toEqual([
      ['jaune', false],
      ['blanc', true],
    ]);
  });
});
