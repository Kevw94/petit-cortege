import { describe, expect, it } from 'vitest';
import { lireParametres } from './parametres';

describe('Paramètres du prototype de performance', () => {
  it('par défaut : 20 000 avatars en sprites individuels, tout le cortège à l’écran', () => {
    expect(lireParametres('')).toEqual({ n: 20_000, technique: 'sprites', vue: 'tout', majMs: 0 });
  });

  it('lit n, la technique et la vue depuis la requête', () => {
    expect(lireParametres('?n=5000&technique=gpulayer&vue=rue')).toEqual({
      n: 5000,
      technique: 'gpulayer',
      vue: 'rue',
      majMs: 0,
    });
  });

  it('lit l’intervalle de recalcul des positions (0 = à chaque image)', () => {
    expect(lireParametres('?maj=250').majMs).toBe(250);
    expect(lireParametres('?maj=abc').majMs).toBe(0);
  });

  it('ignore les valeurs inconnues ou absurdes', () => {
    expect(lireParametres('?n=-3&technique=canvas&vue=ciel&maj=-5')).toEqual({
      n: 20_000,
      technique: 'sprites',
      vue: 'tout',
      majMs: 0,
    });
  });
});
