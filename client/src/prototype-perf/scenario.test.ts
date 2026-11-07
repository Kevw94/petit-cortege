import { describe, expect, it } from 'vitest';
import { calculerCortege } from '../cortege/cortege';
import { scenarioPerf } from './scenario';

describe('Scénario du prototype de performance', () => {
  it('le Cortège place les n avatars générés, tous partis et étalés sur ≈ 4 km', () => {
    // 2 h d'entrées régulières après le départ, à 2 km/h : la tête est à ≈ 4 km, la queue au départ.
    const { manif, entrees, maintenant } = scenarioPerf(20_000);

    const cortege = calculerCortege({ manif, entrees, maintenant });

    expect(cortege.avatars).toHaveLength(20_000);
    const distances = cortege.avatars.map((a) => a.distanceM);
    expect(Math.max(...distances)).toBeGreaterThan(3990);
    expect(Math.max(...distances)).toBeLessThanOrEqual(4000);
    expect(Math.min(...distances)).toBeLessThan(5);
  });

  it('est déterministe (mêmes identifiants, mêmes heures d’entrée)', () => {
    expect(scenarioPerf(1000)).toEqual(scenarioPerf(1000));
  });
});
