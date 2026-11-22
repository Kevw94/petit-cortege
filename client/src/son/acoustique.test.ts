import { describe, expect, it } from 'vitest';
import { instantSousLeSeuil, reponseRue, VITESSE_SON_M_S } from './acoustique';

const TAUX = 48_000;

describe('acoustique de la rue', () => {
  it('déterministe pour une graine, stéréo décorrélée', () => {
    const [g1, d1] = reponseRue({ taux: TAUX, graine: 4 });
    const [g2] = reponseRue({ taux: TAUX, graine: 4 });
    expect(g1).toEqual(g2);
    expect(reponseRue({ taux: TAUX, graine: 5 })[0]).not.toEqual(g1);
    // Gauche et droite ne sont pas identiques : la réverbération enveloppe.
    let produit = 0,
      gg = 0,
      dd = 0;
    for (let i = 0; i < g1.length; i++) {
      produit += g1[i]! * d1[i]!;
      gg += g1[i]! ** 2;
      dd += d1[i]! ** 2;
    }
    expect(Math.abs(produit / Math.sqrt(gg * dd))).toBeLessThan(0.5);
  });

  it('durée demandée, valeurs finies, rien avant le son direct', () => {
    const [g, d] = reponseRue({ taux: TAUX, graine: 1, duree: 1.2 });
    expect(g.length).toBe(Math.round(1.2 * TAUX));
    for (const canal of [g, d]) {
      for (const x of canal) expect(Number.isFinite(x)).toBe(true);
      // Les toutes premières millisecondes sont vides : le son direct n'est pas dans la réponse.
      for (let i = 0; i < Math.round(0.002 * TAUX); i++) expect(Math.abs(canal[i]!)).toBe(0);
    }
  });

  it('premières réflexions des façades, puis une queue qui décroît en un peu plus d’une seconde', () => {
    const largeurM = 18;
    const [g, d] = reponseRue({ taux: TAUX, graine: 2, largeurM, rt60Graves: 1.3 });
    // Première réflexion : une fraction de l'aller-retour vers une façade.
    const premier = (c: Float32Array) => c.findIndex((x) => Math.abs(x) > 0.05) / TAUX;
    const intervalle = largeurM / VITESSE_SON_M_S;
    expect(Math.min(premier(g), premier(d))).toBeLessThan(intervalle);
    // −40 dB atteints vers les deux tiers du temps de réverbération des graves.
    const t40 = instantSousLeSeuil(g, TAUX, -40);
    expect(t40).toBeGreaterThan(0.5);
    expect(t40).toBeLessThan(1.5);
  });

  it('les aigus s’éteignent avant les graves', () => {
    const [g] = reponseRue({ taux: TAUX, graine: 3 });
    // Différence première : passe-haut grossier, comparée au signal entier, au début et à la fin.
    const part = (debutS: number, finS: number) => {
      let aigus = 0,
        tout = 0;
      for (let i = Math.round(debutS * TAUX) + 1; i < Math.round(finS * TAUX); i++) {
        aigus += (g[i]! - g[i - 1]!) ** 2;
        tout += g[i]! ** 2;
      }
      return aigus / tout;
    };
    expect(part(0.6, 1)).toBeLessThan(part(0.05, 0.25) * 0.7);
  });
});
