import { describe, expect, it } from 'vitest';
import { creerMemoireAntiRejeu } from '../src/preuve-travail';

describe('mémoire anti-rejeu des preuves consommées', () => {
  it('retient une signature consommée jusqu’à son expiration, puis l’oublie', () => {
    let maintenant = 0;
    const memoire = creerMemoireAntiRejeu(() => maintenant);
    memoire.consommer('a', 1_000);
    memoire.consommer('b', 2_000);
    expect(memoire.contient('a')).toBe(true);

    maintenant = 1_500;
    memoire.consommer('c', 3_000);
    expect(memoire.contient('a')).toBe(false);
    expect(memoire.contient('b')).toBe(true);
    expect(memoire.taille()).toBe(2);
  });

  it('garde une signature encore valide même si elle a été consommée avant une autre qui expire plus tôt', () => {
    let maintenant = 0;
    const memoire = creerMemoireAntiRejeu(() => maintenant);
    memoire.consommer('longue', 10_000);
    memoire.consommer('courte', 1_000);
    maintenant = 5_000;
    memoire.consommer('suivante', 20_000);
    expect(memoire.contient('longue')).toBe(true);
  });

  it('reste en temps constant par preuve au pic d’une grosse manif (des centaines de milliers en mémoire)', () => {
    let maintenant = 0;
    const memoire = creerMemoireAntiRejeu(() => maintenant);
    const debut = performance.now();
    // 300 000 preuves consommées en 10 minutes (500/s), chacune valable 10 minutes.
    for (let i = 0; i < 300_000; i++) {
      maintenant = i * 2;
      memoire.consommer(`s${i}`, maintenant + 600_000);
    }
    expect(performance.now() - debut).toBeLessThan(2_000);
    expect(memoire.taille()).toBe(300_000);
  });
});
