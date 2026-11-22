import { describe, expect, it } from 'vitest';
import {
  balancementDouble,
  creerBatucada,
  type Instrument,
  MESURES_PAR_SECTION,
  presenceBatucada,
  TEMPS_PAR_MESURE,
} from './batucada';

const mesures = (graine: number, n: number, options?: { breaks?: boolean }) => {
  const b = creerBatucada(graine, options);
  return Array.from({ length: n }, (_, i) => b.mesure(i));
};

describe('batucada', () => {
  it('déterministe pour une graine, différente d’une graine à l’autre', () => {
    expect(mesures(3, 40)).toEqual(mesures(3, 40));
    expect(JSON.stringify(mesures(3, 40))).not.toBe(JSON.stringify(mesures(4, 40)));
  });

  it('frappes triées, dans la mesure, aux doubles croches, de force modérée à pleine', () => {
    for (const { frappes } of mesures(5, 200)) {
      const temps = frappes.map((f) => f.temps);
      expect(temps).toEqual([...temps].sort((a, b) => a - b));
      for (const f of frappes) {
        expect(f.temps).toBeGreaterThanOrEqual(0);
        expect(f.temps).toBeLessThan(TEMPS_PAR_MESURE);
        expect(Number.isInteger(f.temps * 4)).toBe(true);
        expect(f.force).toBeGreaterThan(0);
        expect(f.force).toBeLessThanOrEqual(1);
      }
    }
  });

  it('le groove marque les temps : surdos sur les temps 2 et 4, caisse claire continue', () => {
    const grooves = mesures(6, 200).filter((m) => m.genre === 'groove');
    expect(grooves.length).toBeGreaterThan(100);
    for (const { frappes } of grooves) {
      const de = (i: Instrument) => frappes.filter((f) => f.instrument === i);
      expect(de('surdo1').map((f) => f.temps)).toEqual(expect.arrayContaining([1, 3]));
      expect(de('caixa')).toHaveLength(16);
      expect(de('ganza')).toHaveLength(16);
    }
  });

  it('chaque section finit par une relance ou un break ; après un break, une reprise', () => {
    const ms = mesures(7, 400);
    ms.forEach((m, n) => {
      const fin = n % MESURES_PAR_SECTION === MESURES_PAR_SECTION - 1;
      if (fin) expect(['relance', 'break']).toContain(m.genre);
      else expect(['groove', 'reprise']).toContain(m.genre);
      if (m.genre === 'reprise') expect(ms[n - 1]!.genre).toBe('break');
    });
    const breaks = ms.filter((m) => m.genre === 'break');
    expect(breaks.length).toBeGreaterThan(0);
    // Un break : seul le repique appelle, les surdos répondent à la fin.
    for (const { frappes } of breaks) {
      const instruments = new Set(frappes.map((f) => f.instrument));
      expect([...instruments].sort()).toEqual(['repique', 'surdo1', 'surdo2']);
    }
  });

  it('sans breaks (danse finale) : jamais de silence', () => {
    for (const m of mesures(8, 400, { breaks: false })) {
      expect(m.genre).not.toBe('break');
      expect(m.frappes.some((f) => f.instrument === 'surdo1')).toBe(true);
    }
  });

  it('les motifs varient d’une section à l’autre', () => {
    const ms = mesures(9, MESURES_PAR_SECTION * 12);
    const signatures = new Set(
      Array.from({ length: 12 }, (_, s) =>
        JSON.stringify(
          ms[s * MESURES_PAR_SECTION]!.frappes.filter((f) => f.instrument !== 'ganza').map((f) => [
            f.temps,
            f.instrument,
          ]),
        ),
      ),
    );
    expect(signatures.size).toBeGreaterThan(3);
  });

  it('une mesure hors limites ne joue rien', () => {
    const b = creerBatucada(1);
    expect(b.mesure(-1).frappes).toEqual([]);
    expect(b.mesure(2.5).frappes).toEqual([]);
  });

  it('balancement : les doubles croches paires tombent juste, les impaires traînent un peu', () => {
    expect(balancementDouble(0)).toBe(0);
    expect(balancementDouble(0.5)).toBe(0);
    expect(balancementDouble(0.25)).toBeGreaterThan(0);
    expect(balancementDouble(2.75)).toBeGreaterThan(0);
    expect(balancementDouble(0.25)).toBeLessThan(0.1);
  });

  it('présence du groupe : il approche, passe, s’éloigne et se tait, sur quelques minutes', () => {
    const valeurs = Array.from({ length: 600 }, (_, s) => presenceBatucada(s, 42));
    for (const v of valeurs) expect(v >= 0 && v <= 1).toBe(true);
    // Tout près pendant au moins 40 s sur 10 min, et silencieux un moment aussi.
    expect(valeurs.filter((v) => v > 0.95).length).toBeGreaterThan(40);
    expect(valeurs.filter((v) => v < 0.01).length).toBeGreaterThan(20);
    // Sans à-coup : jamais plus de 0,1 d'écart d'une seconde à l'autre.
    for (let i = 1; i < valeurs.length; i++) expect(Math.abs(valeurs[i]! - valeurs[i - 1]!)).toBeLessThan(0.1);
    expect(presenceBatucada(100, 42)).toBe(presenceBatucada(100, 42));
  });
});
