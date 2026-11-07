import { describe, expect, it } from 'vitest';
import { choisirModeVue, lireModeVue, memoriserModeVue } from './mode-vue';

describe('choix de la vue 2D ou 3D', () => {
  it('par défaut, la 3D quand WebGL est disponible', () => {
    expect(choisirModeVue(null, true)).toBe('3d');
  });

  it('par défaut, la 2D sans WebGL', () => {
    expect(choisirModeVue(null, false)).toBe('2d');
  });

  it('garde le choix mémorisé', () => {
    expect(choisirModeVue('2d', true)).toBe('2d');
    expect(choisirModeVue('3d', true)).toBe('3d');
  });

  it('revient à la 2D si la 3D mémorisée est impossible (pas de WebGL)', () => {
    expect(choisirModeVue('3d', false)).toBe('2d');
  });

  it('ignore une valeur mémorisée inconnue', () => {
    expect(choisirModeVue('isometrique', true)).toBe('3d');
  });
});

describe('mémorisation du choix sur l’appareil', () => {
  const stockage = () => {
    const valeurs = new Map<string, string>();
    return {
      getItem: (cle: string) => valeurs.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
    };
  };

  it('relit le choix mémorisé', () => {
    const s = stockage();
    memoriserModeVue('2d', s);
    expect(lireModeVue(s)).toBe('2d');
  });

  it('sans stockage utilisable (navigation privée, stockage bloqué), rien ne casse', () => {
    const casse = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => memoriserModeVue('3d', casse)).not.toThrow();
    expect(lireModeVue(casse)).toBeNull();
    expect(lireModeVue(undefined)).toBeNull();
  });
});
