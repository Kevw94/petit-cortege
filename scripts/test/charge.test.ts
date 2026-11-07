import { describe, expect, it } from 'vitest';
import { aleaAGraine, centiles, coutCdn, HorlogeAcceleree, profilParDefaut, tirerInstants } from '../charge/outils';

describe('horloge accélérée', () => {
  it('fait avancer le temps virtuel `facteur` fois plus vite que le temps réel', () => {
    let reel = 1_000;
    const horloge = new HorlogeAcceleree(1_000, Date.parse('2026-05-01T13:00:00Z'), 30, () => reel);
    reel = 3_000;
    expect(horloge.maintenant().toISOString()).toBe('2026-05-01T13:01:00.000Z');
    expect(horloge.reelPour(Date.parse('2026-05-01T14:00:00Z'))).toBe(1_000 + 120_000);
  });
});

describe('profil d’affluence', () => {
  it('tire des instants triés, tous dans la fenêtre ouverture → fin', () => {
    const instants = tirerInstants(10_000, profilParDefaut(60, 180), aleaAGraine(1));
    expect(instants).toHaveLength(10_000);
    expect(instants[0]!).toBeGreaterThanOrEqual(-60 * 60_000);
    expect(instants[instants.length - 1]!).toBeLessThan(180 * 60_000);
    expect([...instants].sort((a, b) => a - b)).toEqual(instants);
  });

  it('concentre les entrées autour du départ (pic du premier quart d’heure)', () => {
    const instants = tirerInstants(100_000, profilParDefaut(60, 180), aleaAGraine(2));
    const entre = (a: number, b: number) => instants.filter((t) => t >= a * 60_000 && t < b * 60_000).length;
    // Densité 10 sur 15 min, aire totale ≈ 911 : ≈ 16,5 % des entrées.
    expect(entre(0, 15) / 100_000).toBeCloseTo(150 / 911, 2);
    // Densité de pic ≥ 10 fois celle de l'ouverture.
    expect(entre(0, 1)).toBeGreaterThan(8 * entre(-60, -59));
  });

  it('est reproductible à graine égale', () => {
    expect(tirerInstants(100, profilParDefaut(60, 180), aleaAGraine(7))).toEqual(
      tirerInstants(100, profilParDefaut(60, 180), aleaAGraine(7)),
    );
  });

  it('coupe le profil à la fin pour un parcours court', () => {
    const noeuds = profilParDefaut(60, 30);
    expect(noeuds.map((n) => n.minute)).toEqual([-60, 0, 15, 30]);
  });
});

describe('mesures', () => {
  it('calcule les centiles au rang le plus proche', () => {
    const valeurs = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(centiles(valeurs)).toMatchObject({ n: 100, p50: 50, p95: 95, p99: 99, max: 100, moyenne: 50.5 });
    expect(centiles([])).toMatchObject({ n: 0, max: 0 });
  });

  it('chiffre le coût CDN au Go (10⁹ octets)', () => {
    expect(coutCdn(250e9, { nom: 'test', prixParGo: 0.01, minimumMensuel: 1 })).toBeCloseTo(2.5);
  });
});
