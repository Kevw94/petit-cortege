import { describe, expect, it } from 'vitest';
import type { Parcours } from '@petit-cortege/shared';
import { creerPlacement } from './placement';

// ≈ 1000 m plein est à Paris (1° de longitude ≈ 73 230 m à 48,86° N).
const versEst: Parcours = { type: 'LineString', coordinates: [[2.35, 48.86], [2.35 + 1000 / 73_230, 48.86]] };
// ≈ 500 m plein nord puis ≈ 500 m plein est.
const enEquerre: Parcours = {
  type: 'LineString',
  coordinates: [[2.35, 48.86], [2.35, 48.86 + 500 / 110_540], [2.35 + 500 / 73_230, 48.86 + 500 / 110_540]],
};

describe('Placement des avatars du Cortège à l’écran (16 px = 2 m)', () => {
  it('un avatar à 500 m sur un tracé plein est est à 4000 px du départ', () => {
    const { x, y } = creerPlacement(versEst)(500, 0);

    expect(x).toBeCloseTo(4000, -1);
    expect(y).toBeCloseTo(0, 3);
  });

  it('suit les virages : à 750 m sur le tracé en équerre, 4000 px au nord puis 2000 px à l’est', () => {
    const { x, y } = creerPlacement(enEquerre)(750, 0);

    expect(x).toBeCloseTo(2000, -1);
    expect(y).toBeCloseTo(-4000, -1); // y écran vers le bas
  });

  it('applique le décalage latéral du Cortège, positif à gauche du sens de marche', () => {
    // En marchant vers l'est, la gauche est le nord, donc vers le haut de l'écran.
    const { x, y } = creerPlacement(versEst)(500, 4);

    expect(x).toBeCloseTo(4000, -1);
    expect(y).toBeCloseTo(-32, 3);
  });

  it('prolonge le premier tronçon pour les rangées en attente derrière le départ', () => {
    const { x, y } = creerPlacement(versEst)(-10, 0);

    expect(x).toBeCloseTo(-80, 3);
    expect(y).toBeCloseTo(0, 3);
  });
});
