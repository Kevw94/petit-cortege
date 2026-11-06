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

describe('Placement des avatars à l’écran (16 px = 2 m)', () => {
  it('sans décalage latéral, un avatar à 500 m sur un tracé plein est est à 4000 px du départ', () => {
    const placer = creerPlacement(versEst, { largeurRueM: 0 });

    const { x, y } = placer(500, 'av-1');

    expect(x).toBeCloseTo(4000, -1);
    expect(y).toBeCloseTo(0, 3);
  });

  it('suit les virages : à 750 m sur le tracé en équerre, 4000 px au nord puis 2000 px à l’est', () => {
    const placer = creerPlacement(enEquerre, { largeurRueM: 0 });

    const { x, y } = placer(750, 'av-1');

    expect(x).toBeCloseTo(2000, -1);
    expect(y).toBeCloseTo(-4000, -1); // y écran vers le bas
  });

  it('étale les avatars sur la largeur de la rue, de façon stable pour un même identifiant', () => {
    const placer = creerPlacement(versEst, { largeurRueM: 20 });

    const ys = Array.from({ length: 1000 }, (_, i) => placer(500, `av-${i}`).y);

    // Rue de 20 m = 160 px : décalages perpendiculaires dans [-80, 80], bien répartis.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-80);
    expect(Math.max(...ys)).toBeLessThanOrEqual(80);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(150);
    expect(placer(500, 'av-7')).toEqual(placer(500, 'av-7'));
  });

  it('remplit les 10 tuiles de largeur de façon homogène, même avec des identifiants consécutifs', () => {
    const placer = creerPlacement(versEst, { largeurRueM: 20 });
    const parTuile = new Array<number>(10).fill(0);

    for (let i = 0; i < 2000; i++) parTuile[Math.min(9, Math.floor((placer(500, `av-${i}`).y + 80) / 16))]!++;

    for (const compte of parTuile) expect(compte).toBeGreaterThan(150); // 200 attendus par tuile
  });
});
