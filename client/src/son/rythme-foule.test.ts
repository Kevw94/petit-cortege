import { describe, expect, it } from 'vitest';
import { allureDeDanse, allureImmobile, CADENCE_PAS_PAR_S, TEMPO_DANSE_PAR_S } from '../cortege/marche';
import {
  instantDuTempsDeDanse,
  marcheursProches,
  MARCHEURS_MAX,
  posesDePied,
  premierTempsDeDanse,
} from './rythme-foule';

describe('pas des voisins', () => {
  it('quelques voisins, à la cadence de l’animation, à gauche et à droite', () => {
    const ms = marcheursProches(12);
    expect(ms).toHaveLength(MARCHEURS_MAX);
    expect(marcheursProches(12)).toEqual(ms);
    for (const m of ms) {
      expect(Math.abs(m.cadence / CADENCE_PAS_PAR_S - 1)).toBeLessThan(0.07);
      expect(Math.abs(m.pan)).toBeLessThanOrEqual(1);
      expect(m.niveau > 0 && m.niveau <= 1).toBe(true);
    }
    expect(ms.some((m) => m.pan < 0) && ms.some((m) => m.pan > 0)).toBe(true);
  });

  it('des poses de pied régulières, sans trou ni doublon d’une fenêtre à l’autre', () => {
    for (const m of marcheursProches(3)) {
      // Programmé par fenêtres successives, comme le moteur (toutes les 0,25 s).
      const instants: number[] = [];
      for (let t = 10; t < 40; t += 0.25) instants.push(...posesDePied(m, t, t + 0.25));
      expect(instants).toEqual([...instants].sort((a, b) => a - b));
      for (let i = 1; i < instants.length; i++) {
        const ecart = instants[i]! - instants[i - 1]!;
        expect(Math.abs(ecart - 1 / m.cadence)).toBeLessThan(0.031);
      }
      expect(instants.length).toBeGreaterThan(30 * m.cadence - 2);
      expect(instants.length).toBeLessThan(30 * m.cadence + 2);
    }
  });
});

describe('temps de la danse finale', () => {
  it('chaque temps tombe quand la foule retombe au sol (avatar de phase médiane)', () => {
    const allure = allureImmobile();
    for (const k of [0, 1, 7, 1000, 123_456]) {
      const t = instantDuTempsDeDanse(k);
      expect(allureDeDanse(allure, t, 0.5).sautM).toBeCloseTo(0, 6);
      // Les avatars les plus en avance ou en retard sont à un huitième de temps au plus.
      expect(allureDeDanse(allure, t, 0).sautM).toBeLessThan(allureDeDanse(allure, t + 0.25, 0.5).sautM);
    }
    expect(instantDuTempsDeDanse(1) - instantDuTempsDeDanse(0)).toBeCloseTo(1 / TEMPO_DANSE_PAR_S, 9);
  });

  it('premier temps à venir : jamais dans le passé, jamais un temps de trop', () => {
    for (const t of [0, 0.1, 3.3, 1234.567, 98_765.4321]) {
      const k = premierTempsDeDanse(t);
      expect(instantDuTempsDeDanse(k)).toBeGreaterThanOrEqual(t - 1e-6);
      expect(instantDuTempsDeDanse(k - 1)).toBeLessThan(t);
    }
  });
});
