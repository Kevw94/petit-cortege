import { describe, expect, it } from 'vitest';
import { ecartAuPlusProche, pointDEcouteDeDessus } from './ecoute';
import { proximiteDEcoute } from './son/ambiance';

describe('point d’écoute depuis une vue', () => {
  it('écart au plus proche, 0 sans personne', () => {
    const pts = [
      { x: 10, y: 0 },
      { x: 3, y: 4 },
      { x: -20, y: 5 },
    ];
    expect(ecartAuPlusProche(pts, (p) => p, { x: 0, y: 0 })).toBe(5);
    expect(ecartAuPlusProche([], (p: { x: number; y: number }) => p, { x: 0, y: 0 })).toBe(0);
  });

  it('vue de dessus : de près au milieu des avatars, on est dans la foule ; en vue d’ensemble, loin', () => {
    const ecran = { largeur: 400, hauteur: 800 };
    const foule = [{ x: 200, y: 410 }];
    // Zoom de suivi (24 px/m) : la foule est au centre de l'écran.
    const pres = pointDEcouteDeDessus(foule, ecran, 24);
    expect(pres.ecartM).toBeCloseTo(10 / 24, 6);
    expect(proximiteDEcoute(pres)).toBeGreaterThan(0.9);
    // Vue d'ensemble d'un parcours de 4 km : un pixel pour 10 m.
    expect(proximiteDEcoute(pointDEcouteDeDessus(foule, ecran, 0.1))).toBe(0);
    // De près, mais la caméra partie loin de la foule (glissée de 3 km).
    expect(proximiteDEcoute(pointDEcouteDeDessus([{ x: 200 + 3_000 * 24, y: 400 }], ecran, 24))).toBe(0);
  });
});
