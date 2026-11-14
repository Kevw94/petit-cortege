/**
 * Alentours du décor : carte simplifiée (rues, verts, eau, pâtés de maisons) autour de la
 * bande détaillée, à résolution réduite (cases de 2 × 2 tuiles). Extrait inventé autour de
 * (2.36, 48.87), en mètres (x vers l'est, y vers le sud) : le parcours suit un boulevard
 * est-ouest sur 400 m (y = 0) ; à 300 m au nord une rue résidentielle, un chemin piéton et
 * un bâtiment ; à 400 m au sud un parc en multipolygone (deux morceaux) ; une rue à 1 km.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COUCHE_ALENTOURS,
  lireDecor,
  versTuiles,
  type CarteTiled,
  type CoucheTuilesTiled,
  type Decor,
  type Parcours,
  type Position,
} from '@petit-cortege/shared';
import { requeteAlentours, simplifierExtraitAlentours, texteExtraitAlentours } from '../decor/alentours';
import { genererDecor } from '../decor/carte';
import { lireExtrait, type ElementOverpass, type ExtraitOverpass } from '../decor/osm';
import { TUILES } from '../decor/tuiles';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const KX = 111_320 * Math.cos((48.87 * Math.PI) / 180);
const KY = 110_540;
const enPosition = (x: number, y: number): Position => [2.36 + x / KX, 48.87 - y / KY];
const geom = (...points: [number, number][]) => points.map(([x, y]) => {
  const [lon, lat] = enPosition(x, y);
  return { lat, lon };
});

const ALENTOURS: ExtraitOverpass = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'primary', name: 'Boulevard Test' }, nodes: [1, 2], geometry: geom([-200, 0], [600, 0]) },
    { type: 'way', id: 2, tags: { highway: 'residential', name: 'Rue du Nord', 'maxspeed': '30' }, nodes: [3, 4], geometry: geom([-200, -300], [600, -300]) },
    { type: 'way', id: 3, tags: { highway: 'footway' }, geometry: geom([0, -320], [400, -320]) },
    { type: 'way', id: 4, tags: { building: 'yes' }, geometry: geom([100, -350], [140, -350], [140, -380], [100, -380], [100, -350]) },
    { type: 'way', id: 5, tags: { highway: 'residential', name: 'Rue Lointaine' }, geometry: geom([-200, -1000], [600, -1000]) },
    { type: 'node', id: 6, lat: 48.87, lon: 2.36, tags: { shop: 'bakery', name: 'Boulangerie' } },
    {
      type: 'relation',
      id: 7,
      tags: { type: 'multipolygon', leisure: 'park', name: 'Parc Test' },
      members: [
        { type: 'way', ref: 71, role: 'outer', geometry: geom([100, 380], [300, 380], [300, 480]) },
        { type: 'way', ref: 72, role: 'outer', geometry: geom([300, 480], [100, 480], [100, 380]) },
      ],
    },
  ] as ElementOverpass[],
};

let parcours: Parcours;
let carte: CarteTiled;
let decor: Decor;
let sansAlentours: Decor;
/** Gid de la case des alentours au point (x, y) en mètres. */
const caseEn = (x: number, y: number) => {
  const a = decor.alentours!;
  const t = versTuiles(decor.georef, enPosition(x, y));
  const cx = Math.floor(t.x / a.tuilesParCase) - a.x;
  const cy = Math.floor(t.y / a.tuilesParCase) - a.y;
  if (cx < 0 || cy < 0 || cx >= a.largeur || cy >= a.hauteur) return 0;
  return a.gids[cy * a.largeur + cx];
};

beforeAll(async () => {
  const osm = JSON.parse(await readFile(join(FIXTURES, 'extrait-mini.json'), 'utf8'));
  parcours = JSON.parse(await readFile(join(FIXTURES, 'parcours-mini.geojson'), 'utf8')).geometry;
  carte = genererDecor({ osm, parcours, demiLargeurM: 100, alentours: { osm: simplifierExtraitAlentours(ALENTOURS), rayonM: 700 } });
  decor = await lireDecor(carte);
  sansAlentours = await lireDecor(genererDecor({ osm, parcours, demiLargeurM: 100 }));
});

describe('requête Overpass des alentours', () => {
  it('demande rues, verts et eau autour du parcours, sans bâtiments', () => {
    const requete = requeteAlentours(parcours, 700);
    expect(requete).toContain('(around:780,48.870000,2.360000,48.870000,2.365463)');
    expect(requete).toMatch(/way\(around[^;]*\["highway"~"\^\(motorway\|trunk/);
    expect(requete).toContain('["leisure"~"^(park|');
    expect(requete).toContain('relation(around');
    expect(requete).not.toContain('building');
    expect(requete).not.toContain('footway');
  });
});

describe('extrait simplifié des alentours', () => {
  const simplifie = simplifierExtraitAlentours(ALENTOURS);

  it('ne garde que les rues, verts et eau, sans noms ni tags inutiles', () => {
    expect(simplifie.elements.map((e) => e.id)).toEqual([1, 2, 5, 7]);
    expect(simplifie.elements[1]!.tags).toEqual({ highway: 'residential' });
    expect(texteExtraitAlentours(simplifie)).not.toMatch(/Rue du Nord|Boulangerie|Parc Test/);
  });

  it('reste lisible par lireExtrait : les anneaux des multipolygones se recollent', () => {
    const parc = lireExtrait(JSON.parse(texteExtraitAlentours(simplifie))).find((o) => o.id === 'relation/7')!;
    expect(parc.anneaux).toHaveLength(1);
    expect(texteExtraitAlentours(simplifie)).toMatch(/OpenStreetMap, ODbL/);
  });
});

describe('couche des alentours', () => {
  it('est une couche de tuiles à part, en cases de 2 × 2 tuiles, absente des couches de la bande', () => {
    const couche = carte.layers.find((c) => c.name === COUCHE_ALENTOURS) as CoucheTuilesTiled;
    expect(couche.type).toBe('tilelayer');
    expect(couche.properties).toEqual([{ name: 'tuiles_par_case', type: 'int', value: 2 }]);
    expect(decor.nomsCouches).not.toContain(COUCHE_ALENTOURS);
    expect(decor.alentours?.tuilesParCase).toBe(2);
    // Elle déborde de l'emprise de la bande (blocs aux coordonnées négatives).
    expect(decor.alentours!.x).toBeLessThan(0);
    expect(decor.alentours!.y).toBeLessThan(0);
  });

  it('ne change rien à la bande détaillée', () => {
    expect(decor.largeur).toBe(sansAlentours.largeur);
    expect(decor.hauteur).toBe(sansAlentours.hauteur);
    expect([...decor.blocs.keys()]).toEqual([...sansAlentours.blocs.keys()]);
    expect(sansAlentours.alentours).toBeUndefined();
  });

  it('dessine rues, verts et pâtés de maisons hors de la bande, sans bâtiment ni chemin', () => {
    expect(caseEn(300, 0)).toBe(TUILES.chaussee);
    expect(caseEn(300, -300)).toBe(TUILES.chaussee);
    // Trottoirs de part et d'autre de la chaussée (rue de 12 m en tout).
    const travers = Array.from({ length: 25 }, (_, i) => caseEn(300, -312 + i));
    expect(travers).toContain(TUILES.trottoir);
    expect(travers.indexOf(TUILES.trottoir)).toBeLessThan(travers.indexOf(TUILES.chaussee));
    expect(caseEn(200, -320)).toBe(TUILES.pateDeMaisons); // chemin piéton ignoré
    expect(caseEn(120, -365)).toBe(TUILES.pateDeMaisons); // bâtiment ignoré
    expect(caseEn(200, 430)).toBe(TUILES.vert);
  });

  it('s’arrête au rayon des alentours', () => {
    expect(caseEn(300, -650)).toBe(TUILES.pateDeMaisons);
    expect(caseEn(300, -760)).toBe(0);
    expect(caseEn(300, -1000)).toBe(0);
  });
});
