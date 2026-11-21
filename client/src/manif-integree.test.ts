import { describe, expect, it } from 'vitest';
import type { ManifPubliee } from '@petit-cortege/shared';
import { lireManifIntegree } from './manif-integree';

const manif: ManifPubliee = {
  id: 'paris-2026-11-17',
  intitule: 'Grève',
  ville: 'Paris',
  ouverture: '2026-11-17T10:00:00.000Z',
  depart: '2026-11-17T13:00:00.000Z',
  fin: '2026-11-17T15:30:00.000Z',
  parcours: {
    type: 'LineString',
    coordinates: [
      [2.39, 48.85],
      [2.36, 48.83],
    ],
  },
  longueurM: 1000,
  sources: [],
  compteur: 0,
};

describe('manif intégrée à la page', () => {
  it('relit la manif embarquée quand c’est la bonne', () => {
    expect(lireManifIntegree(JSON.stringify(manif), 'paris-2026-11-17')).toEqual(manif);
  });

  it('ignore un texte vide, illisible, ou d’une autre manif', () => {
    expect(lireManifIntegree(null, 'paris-2026-11-17')).toBeUndefined();
    expect(lireManifIntegree('{', 'paris-2026-11-17')).toBeUndefined();
    expect(lireManifIntegree(JSON.stringify(manif), 'lyon-2026-11-17')).toBeUndefined();
    expect(lireManifIntegree(JSON.stringify({ ...manif, parcours: { type: 'Point' } }), manif.id)).toBeUndefined();
  });
});
