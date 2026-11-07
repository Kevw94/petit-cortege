import { describe, expect, it } from 'vitest';
import { lireParcoursGeoJson } from '../src/index';

describe('parcours lu depuis un export uMap', () => {
  it('arrondit les coordonnées à 6 décimales (≈ 10 cm) : la liste des manifs, relue toutes les 20 s par chaque client, reste légère', () => {
    const parcours = lireParcoursGeoJson({
      type: 'LineString',
      coordinates: [
        [2.363414764404297, 48.86730194091797, 35.2],
        [2.3683000000000001, 48.864899999999999],
      ],
    });
    expect(parcours.coordinates).toEqual([
      [2.363415, 48.867302],
      [2.3683, 48.8649],
    ]);
    expect(JSON.stringify(parcours.coordinates)).toBe('[[2.363415,48.867302],[2.3683,48.8649]]');
  });
});
