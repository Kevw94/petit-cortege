/**
 * Extrait OSM réduit aux tags que le décor lit : plus de coordonnées de tiers (email,
 * téléphone, site…) dans donnees/osm/, et le décor généré ne change pas.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Parcours } from '@petit-cortege/shared';
import { genererDecor } from '../decor/carte';
import { itineraireLeLongDe } from '../decor/itineraire';
import { lireExtrait, type ExtraitOverpass } from '../decor/osm';
import { reduireExtrait, texteExtrait } from '../decor/reduction';

const RACINE = join(import.meta.dirname, '../..');
const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const lireJson = async (chemin: string) => JSON.parse(await readFile(chemin, 'utf8'));

const geometrie = [
  { lat: 48.87, lon: 2.36 },
  { lat: 48.871, lon: 2.361 },
];

describe('Extrait OSM réduit', () => {
  it('ne garde que les tags lus par le décor (plus d’email, de téléphone ni de contact)', () => {
    const extrait = reduireExtrait({
      elements: [
        {
          type: 'way',
          id: 1,
          nodes: [10, 11],
          geometry: geometrie,
          tags: {
            highway: 'residential',
            name: 'Rue Haute',
            lanes: '2',
            email: 'contact@exemple.fr',
            phone: '+33 1 23 45 67 89',
            'contact:email': 'a@b.fr',
            website: 'https://exemple.fr',
            opening_hours: 'Mo-Fr 09:00-18:00',
            wikidata: 'Q1',
          },
        },
      ],
    });

    expect(extrait.elements).toEqual([
      { type: 'way', id: 1, nodes: [10, 11], geometry: geometrie, tags: { highway: 'residential', name: 'Rue Haute', lanes: '2' } },
    ]);
  });

  it('garde le nom des rues, places et surfaces (zones à éviter), pas celui des chemins qui ne sont que des bâtiments', () => {
    const anneau = [...geometrie, { lat: 48.871, lon: 2.36 }, geometrie[0]!];
    const extrait = reduireExtrait({
      elements: [
        { type: 'node', id: 1, lat: 48.87, lon: 2.36, tags: { place: 'square', name: 'Place Carnot', 'name:en': 'Carnot Square' } },
        { type: 'way', id: 2, geometry: anneau, tags: { leisure: 'park', name: 'Jardin des Plantes' } },
        { type: 'way', id: 3, geometry: anneau, tags: { building: 'train_station', name: 'Gare Centrale', shop: 'bakery' } },
        { type: 'way', id: 5, geometry: geometrie, tags: { building: 'yes', name: 'Auvent Dupont' } },
        { type: 'relation', id: 6, tags: { type: 'multipolygon' }, members: [] },
        { type: 'relation', id: 4, tags: { type: 'multipolygon', 'area:highway': 'pedestrian', name: 'Parvis Notre-Dame' }, members: [] },
      ],
    });

    expect(extrait.elements.map((e) => e.tags)).toEqual([
      { place: 'square', name: 'Place Carnot' },
      { leisure: 'park', name: 'Jardin des Plantes' },
      { building: 'train_station', name: 'Gare Centrale' },
      { building: 'yes' },
      { type: 'multipolygon', 'area:highway': 'pedestrian', name: 'Parvis Notre-Dame' },
    ]);
  });

  it('retire les éléments sans aucun tag utile, les `bounds`, et les nœuds des chemins qui ne sont pas des rues', () => {
    const extrait = reduireExtrait({
      elements: [
        { type: 'way', id: 1, nodes: [1, 2], geometry: geometrie, tags: { man_made: 'pier', name: 'Jetée' } },
        { type: 'way', id: 2, nodes: [1, 2], geometry: geometrie, tags: { waterway: 'canal' }, bounds: { minlat: 1 } } as never,
      ],
    });

    expect(extrait.elements).toEqual([{ type: 'way', id: 2, geometry: geometrie, tags: { waterway: 'canal' } }]);
  });

  it('écrit un élément par ligne, relisible, avec la mention ODbL d’Overpass', () => {
    const brut = {
      version: 0.6,
      generator: 'Overpass API',
      osm3s: { timestamp_osm_base: '2026-11-14T14:26:06Z', copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' },
      elements: [
        { type: 'way' as const, id: 1, geometry: geometrie, tags: { highway: 'primary' } },
        { type: 'way' as const, id: 2, geometry: geometrie, tags: { highway: 'service' } },
      ],
    };

    const texte = texteExtrait(reduireExtrait(brut));

    expect(JSON.parse(texte)).toEqual(brut);
    expect(texte.split('\n').filter((l) => l.startsWith('{"type"'))).toHaveLength(2);
    expect(texte).toMatch(/ODbL/);
    // Réduire un extrait déjà réduit ne change rien (réécriture des extraits existants).
    expect(texteExtrait(reduireExtrait(JSON.parse(texte)))).toBe(texte);
  });

  it('donne exactement le même décor et le même itinéraire que l’extrait brut', async () => {
    const brut: ExtraitOverpass = await lireJson(join(FIXTURES, 'extrait-mini.json'));
    const parcours: Parcours = (await lireJson(join(FIXTURES, 'parcours-mini.geojson'))).geometry;
    const reduit = reduireExtrait(brut);

    expect(genererDecor({ osm: reduit, parcours, demiLargeurM: 100 })).toEqual(genererDecor({ osm: brut, parcours, demiLargeurM: 100 }));
  });

  it('garde toutes les surfaces nommées, que le contrôle des zones à éviter compare', async () => {
    const brut: ExtraitOverpass = await lireJson(join(FIXTURES, 'extrait-mini.json'));
    const surfacesNommees = (extrait: ExtraitOverpass) =>
      lireExtrait(extrait)
        .filter((o) => o.anneaux.length > 0 && o.tags.name)
        .map((o) => ({ id: o.id, nom: o.tags.name, anneaux: o.anneaux }));

    expect(surfacesNommees(reduireExtrait(brut))).toEqual(surfacesNommees(brut));
  });

  it('les extraits versionnés ne contiennent plus de tag hors de la liste', async () => {
    for (const id of ['republique-nation', 'paris-2026-11-14', 'nancy-2026-11-14', 'caen-2026-11-14']) {
      const texte = await readFile(join(RACINE, 'donnees/osm', id, 'extrait-overpass.json'), 'utf8');
      expect(texteExtrait(reduireExtrait(JSON.parse(texte))), id).toBe(texte);
      expect(texte, id).not.toMatch(/"(email|phone|website|opening_hours|contact:[^"]*)":/);
    }
  });
});

describe('Itinéraire sur un extrait réduit', () => {
  it('suit les mêmes chemins que sur l’extrait brut', async () => {
    const brut: ExtraitOverpass = await lireJson(join(FIXTURES, 'extrait-mini.json'));
    const options = { rues: ['Boulevard Test', 'Place Test'], depart: [2.359, 48.87] as [number, number], arrivee: [2.367, 48.87] as [number, number] };

    expect(itineraireLeLongDe(reduireExtrait(brut), options)).toEqual(itineraireLeLongDe(brut, options));
  });
});
