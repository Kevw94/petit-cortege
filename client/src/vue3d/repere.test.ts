import { describe, expect, it } from 'vitest';
import {
  METRES_PAR_TUILE,
  positionDansLeCortege,
  versTuiles,
  type Parcours,
  type Position,
} from '@petit-cortege/shared';
import { creerPlaceur, versMetres, versScene } from './repere';

describe('mètres → coordonnées de la scène 3D', () => {
  it('x reste l’est, y (vers le sud) devient z, la hauteur devient y', () => {
    expect(versScene({ x: 12, y: 30 })).toEqual({ x: 12, y: 0, z: 30 });
    expect(versScene({ x: -4, y: 7 }, 1.75)).toEqual({ x: -4, y: 1.75, z: 7 });
  });

  it('et inversement, du sol de la scène vers les mètres', () => {
    expect(versMetres({ x: 12, y: 5, z: 30 })).toEqual({ x: 12, y: 30 });
  });
});

// Boulevard en L près de République : 300 m vers l'est, puis ≈ 500 m vers le sud-est.
const origine: Position = [2.3633, 48.8674];
const parcours: Parcours = {
  type: 'LineString',
  coordinates: [origine, [2.3674, 48.8674], [2.37, 48.8655], [2.372, 48.864]],
};
const projeter = (p: Position) => {
  const t = versTuiles({ origine }, p);
  return { x: t.x * METRES_PAR_TUILE, y: t.y * METRES_PAR_TUILE };
};

describe('placement le long du parcours (projection du décor)', () => {
  const placeur = creerPlaceur(parcours, projeter);

  it('place les avatars là où le Cortège les met, au centimètre près', () => {
    for (const [distance, decalage] of [
      [0, 0],
      [120, 2],
      [301, -4],
      [450, 3],
      [-6, 1],
      [5000, 0],
    ] as const) {
      const attendu = projeter(positionDansLeCortege(parcours, distance, decalage));
      const place = placeur.placer(distance, decalage);
      expect(Math.hypot(place.x - attendu.x, place.y - attendu.y)).toBeLessThan(0.01);
    }
  });

  it('un décalage positif est à gauche du sens de marche (au nord quand on marche vers l’est)', () => {
    const centre = placeur.placer(100, 0);
    const gauche = placeur.placer(100, 4);
    expect(gauche.y).toBeCloseTo(centre.y - 4, 3);
    expect(gauche.x).toBeCloseTo(centre.x, 3);
  });

  it('donne la direction de marche : vers l’est sur le premier tronçon, puis vers le sud-est', () => {
    expect(placeur.cap(100)).toBeCloseTo(0, 3);
    const apres = placeur.cap(400);
    expect(apres).toBeGreaterThan(0.3); // y vers le sud : angle positif = vers le sud
    expect(apres).toBeLessThan(Math.PI / 2);
  });

  it('connaît la longueur du parcours', () => {
    expect(placeur.longueurM).toBeGreaterThan(750);
    expect(placeur.longueurM).toBeLessThan(850);
  });
});
