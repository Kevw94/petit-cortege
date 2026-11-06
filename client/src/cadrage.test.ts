import { describe, expect, it } from 'vitest';
import { cadrerSur, deplacer, ECHELLE_MAX_PX_PAR_M, versEcran, zoomerAutour } from './cadrage';

const ECRAN = { largeur: 400, hauteur: 800 };
// Parcours de 1 km de large sur 2 km de haut (mètres, y vers le bas).
const EMPRISE = { minX: 0, maxX: 1000, minY: 0, maxY: 2000 };

describe('cadrage de la vue', () => {
  it('au départ, tout le parcours tient à l’écran, centré, avec une marge', () => {
    const cadrage = cadrerSur(EMPRISE, ECRAN, 32);

    // (400 - 2 × 32) / 1000 = 0,336 px/m en largeur ; (800 - 64) / 2000 = 0,368 en hauteur.
    expect(cadrage.echelle).toBeCloseTo(0.336);
    expect(versEcran(cadrage, ECRAN)({ x: 500, y: 1000 })).toEqual({ x: 200, y: 400 });
  });

  it('zoomer au doigt garde sous le doigt le point qui y était', () => {
    const cadrage = cadrerSur(EMPRISE, ECRAN, 32);
    const doigt = { x: 300, y: 100 };
    const avant = versEcran(cadrage, ECRAN);
    const pointSousLeDoigt = { x: 500 + (300 - 200) / cadrage.echelle, y: 1000 + (100 - 400) / cadrage.echelle };
    expect(avant(pointSousLeDoigt).x).toBeCloseTo(300);

    const zoome = zoomerAutour(cadrage, 10, doigt, ECRAN);

    expect(zoome.echelle).toBeCloseTo(3.36);
    const apres = versEcran(zoome, ECRAN)(pointSousLeDoigt);
    expect(apres.x).toBeCloseTo(300);
    expect(apres.y).toBeCloseTo(100);
  });

  it('le zoom est borné : on ne zoome pas au-delà de la lecture des pancartes', () => {
    const cadrage = cadrerSur(EMPRISE, ECRAN, 32);

    expect(zoomerAutour(cadrage, 1e6, { x: 0, y: 0 }, ECRAN).echelle).toBe(ECHELLE_MAX_PX_PAR_M);
  });

  it('glisser le doigt déplace la vue d’autant', () => {
    const cadrage = cadrerSur(EMPRISE, ECRAN, 32);

    const deplace = deplacer(cadrage, { x: 40, y: -20 });

    const centre = versEcran(deplace, ECRAN)({ x: 500, y: 1000 });
    expect(centre.x).toBeCloseTo(240);
    expect(centre.y).toBeCloseTo(380);
  });
});
