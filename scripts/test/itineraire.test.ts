/**
 * Parcours de démo tracé sur les chemins OSM d'une rue (ex. République → Nation
 * par le boulevard Voltaire) : coordonnées issues des chemins, pas dessinées à la main.
 */
import { describe, expect, it } from 'vitest';
import { itineraireLeLongDe } from '../decor/itineraire';
import type { ElementOverpass } from '../decor/osm';

/** Chemin Overpass (`out geom`) : nœuds [id, lon, lat]. */
const chemin = (id: number, tags: Record<string, string>, noeuds: [number, number, number][]): ElementOverpass => ({
  type: 'way',
  id,
  tags,
  nodes: noeuds.map((n) => n[0]),
  geometry: noeuds.map(([, lon, lat]) => ({ lon, lat })),
});

// Une rue coupée en trois chemins (dont un dessiné à l'envers), une piste cyclable
// du même nom qui fait un raccourci, une autre rue.
const extrait = {
  elements: [
    chemin(1, { highway: 'secondary', name: 'Rue Longue' }, [
      [1, 0, 0],
      [2, 0.001, 0],
      [3, 0.002, 0],
    ]),
    chemin(2, { highway: 'secondary', name: 'Rue Longue' }, [
      [5, 0.004, -0.001],
      [4, 0.003, 0],
      [3, 0.002, 0],
    ]),
    chemin(3, { highway: 'secondary', name: 'Rue Longue' }, [
      [5, 0.004, -0.001],
      [6, 0.005, -0.001],
    ]),
    chemin(4, { highway: 'cycleway', name: 'Rue Longue' }, [
      [1, 0, 0],
      [6, 0.005, -0.001],
    ]),
    chemin(5, { highway: 'residential', name: 'Rue Voisine' }, [
      [2, 0.001, 0],
      [7, 0.001, 0.003],
    ]),
  ],
};

describe('itinéraire le long d’une rue', () => {
  it('suit les chemins de la rue, du nœud le plus proche du départ à celui le plus proche de l’arrivée', () => {
    const parcours = itineraireLeLongDe(extrait, {
      rues: ['Rue Longue'],
      depart: [0.0001, 0.0001],
      arrivee: [0.0049, -0.0011],
    });
    expect(parcours).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.001, 0],
        [0.002, 0],
        [0.003, 0],
        [0.004, -0.001],
        [0.005, -0.001],
      ],
    });
  });

  it('refuse un départ et une arrivée que la rue ne relie pas', () => {
    expect(() =>
      itineraireLeLongDe(
        { elements: [extrait.elements[0]!, extrait.elements[2]!] },
        { rues: ['Rue Longue'], depart: [0, 0], arrivee: [0.005, -0.001] },
      ),
    ).toThrow(/ne relie pas/);
  });

  it('emprunte les autres rues données pour relier deux tronçons (ex. une place traversée)', () => {
    const coupee = {
      elements: [
        extrait.elements[0]!,
        chemin(6, { highway: 'secondary', name: 'Place Ronde' }, [
          [3, 0.002, 0],
          [8, 0.0025, 0.0005],
          [5, 0.004, -0.001],
        ]),
        extrait.elements[2]!,
      ],
    };
    const parcours = itineraireLeLongDe(coupee, {
      rues: ['Rue Longue', 'Place Ronde'],
      depart: [0, 0],
      arrivee: [0.005, -0.001],
    });
    expect(parcours.coordinates).toEqual([
      [0, 0],
      [0.001, 0],
      [0.002, 0],
      [0.0025, 0.0005],
      [0.004, -0.001],
      [0.005, -0.001],
    ]);
  });

  it('refuse une rue absente de l’extrait', () => {
    expect(() =>
      itineraireLeLongDe(extrait, { rues: ['Rue Inconnue'], depart: [0, 0], arrivee: [0.005, -0.001] }),
    ).toThrow(/Rue Inconnue/);
  });
});
