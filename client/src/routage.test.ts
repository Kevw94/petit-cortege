import { describe, expect, it } from 'vitest';
import { lienManif, lienPageLegale, lireRoute } from './routage';

describe('routage', () => {
  it('ouvre la page publique /manif/<id>', () => {
    expect(lireRoute('/manif/paris-2026-11-17')).toEqual({ page: 'manif', id: 'paris-2026-11-17' });
    expect(lireRoute('/manif/paris-2026-11-17/')).toEqual({ page: 'manif', id: 'paris-2026-11-17' });
    expect(lienManif('paris-2026-11-17')).toBe('/manif/paris-2026-11-17');
  });

  it('garde les fragments déjà partagés et les pages légales', () => {
    expect(lireRoute('#/manif/vie-privee')).toEqual({ page: 'manif', id: 'vie-privee' });
    expect(lireRoute('/#/vie-privee')).toEqual({ page: 'legale', id: 'vie-privee' });
    expect(lireRoute('#/')).toEqual({ page: 'liste' });
    expect(lireRoute('#/inconnue')).toEqual({ page: 'liste' });
    expect(lienPageLegale('charte')).toBe('/#/charte');
  });

  it('un fragment explicite gagne sur le chemin de la manif', () => {
    expect(lireRoute('/manif/paris-2026-11-17#/')).toEqual({ page: 'liste' });
    expect(lireRoute('/manif/paris-2026-11-17#/vie-privee')).toEqual({ page: 'legale', id: 'vie-privee' });
  });
});
