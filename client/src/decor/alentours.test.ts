import { describe, expect, it } from 'vitest';
import { distancesAuVide, partDeLaCase } from './alentours';

describe('fondu au bord des alentours', () => {
  it('mesure la distance de chaque case au vide, l’extérieur de la grille comptant comme vide', () => {
    // 5 × 3 : une case vide au milieu de la rangée du haut.
    const gids = new Uint32Array([1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const d = distancesAuVide(gids, 5, 3);
    expect(d[2]).toBe(0);
    expect(d[7]).toBe(1); // juste sous la case vide
    expect(d[0]).toBe(1); // au bord de la grille
    expect(d[12]).toBe(1);
  });

  it('va du fond (bord) à la couleur propre de la case (au-delà du fondu), sans palier', () => {
    expect(partDeLaCase(0, 30)).toBe(0);
    expect(partDeLaCase(15, 30)).toBeCloseTo(0.5);
    expect(partDeLaCase(30, 30)).toBe(1);
    expect(partDeLaCase(1000, 30)).toBe(1);
    expect(partDeLaCase(10, 30)).toBeLessThan(partDeLaCase(11, 30));
  });
});
