import { describe, expect, it } from 'vitest';
import { lireEtapesAnnoncees, lireParcoursGeoJson } from '../src/index';

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

  it('lit les noms d’étapes annoncés, et rien sur un tracé uMap sans propriétés', () => {
    expect(
      lireEtapesAnnoncees({
        type: 'Feature',
        properties: {
          etapes: [
            { demande: 'Nation', libelle: 'Place de la Nation' },
            { libelle: 'Place d’Italie' },
            { demande: '   ' },
          ],
        },
        geometry: { type: 'LineString', coordinates: [[2.4, 48.85], [2.36, 48.83]] },
      }),
    ).toEqual(['Nation', 'Place d’Italie']);
    expect(lireParcoursGeoJson({ type: 'LineString', coordinates: [[2.35, 48.85], [2.36, 48.86]] }).type).toBe('LineString');
    expect(lireEtapesAnnoncees({ type: 'LineString', coordinates: [[2.35, 48.85], [2.36, 48.86]] })).toEqual([]);
  });
});
