/**
 * Plan de la ville (couche `alentours`) : carte simplifiée (rues, verts, eau, pâtés de maisons)
 * sur le carré couvrant le dézoom maximal, à résolution réduite (cases de 4 × 4 tuiles, 8 m).
 * Extrait inventé autour de
 * (2.36, 48.87), en mètres (x vers l'est, y vers le sud) : le parcours suit un boulevard
 * est-ouest sur 400 m (y = 0) ; à 300 m au nord une rue résidentielle, un chemin piéton et
 * un bâtiment ; à 400 m au sud un parc en multipolygone (deux morceaux) ; une rue à 1 km.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  COUCHE_ALENTOURS,
  empriseDuPlan,
  facteurDiagonaleEcran,
  FONDU_PLAN_M,
  lireDecor,
  versTuiles,
  type CarteTiled,
  type CoucheTuilesTiled,
  type Decor,
  type Parcours,
  type Position,
} from '@petit-cortege/shared';
import {
  fusionnerExtraits,
  paves,
  rectangleDuPlan,
  requetePlan,
  requetesPlan,
  simplifierExtraitAlentours,
  TEINTES_ILOTS,
  telechargerPlan,
  tuilesParCasePour,
  texteExtraitAlentours,
} from '../decor/alentours';
import { genererDecor } from '../decor/carte';
import { lireExtrait, type ElementOverpass, type ExtraitOverpass } from '../decor/osm';
import { TUILES } from '../decor/tuiles';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const KX = 111_320 * Math.cos((48.87 * Math.PI) / 180);
const KY = 110_540;
const enPosition = (x: number, y: number): Position => [2.36 + x / KX, 48.87 - y / KY];
const geom = (...points: [number, number][]) =>
  points.map(([x, y]) => {
    const [lon, lat] = enPosition(x, y);
    return { lat, lon };
  });

const ALENTOURS: ExtraitOverpass = {
  elements: [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Boulevard Test' },
      nodes: [1, 2],
      geometry: geom([-200, 0], [600, 0]),
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential', name: 'Rue du Nord', maxspeed: '30' },
      nodes: [3, 4],
      geometry: geom([-200, -300], [600, -300]),
    },
    { type: 'way', id: 3, tags: { highway: 'footway' }, geometry: geom([0, -320], [400, -320]) },
    {
      type: 'way',
      id: 4,
      tags: { building: 'yes' },
      geometry: geom([100, -350], [140, -350], [140, -380], [100, -380], [100, -350]),
    },
    {
      type: 'way',
      id: 5,
      tags: { highway: 'residential', name: 'Rue Lointaine' },
      geometry: geom([-200, -1000], [600, -1000]),
    },
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
  carte = genererDecor({ osm, parcours, demiLargeurM: 100, alentours: { osm: simplifierExtraitAlentours(ALENTOURS) } });
  decor = await lireDecor(carte);
  sansAlentours = await lireDecor(genererDecor({ osm, parcours, demiLargeurM: 100 }));
});

describe('emprise du plan', () => {
  it('couvre l’écran entier au dézoom maximal dans tous les formats, plus le fondu', () => {
    // 21:9 : l'écran fait 21/9 × 1 rayons, sa demi-diagonale ≈ 2,54 rayons.
    expect(facteurDiagonaleEcran()).toBeCloseTo(Math.hypot(1, 2560 / 1080), 6);
    const e = empriseDuPlan([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    expect(e.centre).toEqual({ x: 200, y: 0 });
    expect(e.demiCote).toBeGreaterThan((200 + 40) * Math.hypot(1, 2560 / 1080) + FONDU_PLAN_M);
    expect(e.demiCote).toBeLessThan(1000);
    expect(e.borne).toBe(false);
  });

  it('grandit avec le parcours (plusieurs km pour un défilé parisien), borné à 12 km de côté', () => {
    const paris = empriseDuPlan([
      { x: 0, y: 0 },
      { x: 3000, y: 1200 },
    ]);
    expect(2 * paris.demiCote).toBeGreaterThan(8000);
    expect(2 * paris.demiCote).toBeLessThan(10_000);
    const immense = empriseDuPlan([
      { x: 0, y: 0 },
      { x: 9000, y: 0 },
    ]);
    expect(2 * immense.demiCote).toBe(12_000);
    expect(immense.borne).toBe(true);
  });
});

describe('résolution du plan', () => {
  it('cases de 4 m pour un petit plan (jusqu’à ≈ 4 km de côté), de 8 m au-delà, la même sur tout le plan', () => {
    expect(tuilesParCasePour(1500)).toBe(2);
    expect(tuilesParCasePour(2048)).toBe(2);
    expect(tuilesParCasePour(2100)).toBe(4);
    expect(tuilesParCasePour(4500)).toBe(4);
  });
});

describe('requêtes Overpass du plan', () => {
  it('demande rues, verts et eau par rectangle, sans bâtiments ni chemins', () => {
    const requete = requetePlan({ sud: 48.86, ouest: 2.35, nord: 48.88, est: 2.37 });
    expect(requete).toContain('[bbox:48.860000,2.350000,48.880000,2.370000]');
    expect(requete).toMatch(/way\["highway"~"\^\(motorway\|trunk/);
    expect(requete).toContain('["leisure"~"^(park|');
    expect(requete).toContain('relation["type"="multipolygon"]');
    expect(requete).not.toContain('building');
    expect(requete).not.toContain('footway');
  });

  it('découpe une grande emprise en pavés d’au plus 3 km qui la recouvrent exactement', () => {
    const r = { sud: 48.82, ouest: 2.3, nord: 48.9, est: 2.42 }; // ≈ 8,8 × 8,8 km
    const p = paves(r);
    expect(p).toHaveLength(9);
    expect(Math.min(...p.map((x) => x.sud))).toBe(r.sud);
    expect(Math.max(...p.map((x) => x.est))).toBeCloseTo(r.est, 12);
    // Le petit parcours de la fixture tient en un pavé.
    expect(requetesPlan(parcours)).toHaveLength(1);
    const plan = rectangleDuPlan(parcours);
    expect(plan.nord - plan.sud).toBeGreaterThan(1.7 / 110.54);
  });

  it('télécharge pavé par pavé et fusionne sans doublons', async () => {
    const vues: string[] = [];
    const extrait = await telechargerPlan(
      parcours,
      async (requete) => {
        vues.push(requete);
        return { extrait: ALENTOURS, url: 'https://overpass.exemple/api/interpreter' };
      },
      () => {},
      { demiCoteM: 2000, pauseMs: 0 },
    );
    expect(vues).toHaveLength(4);
    expect(extrait.elements.map((e) => e.id)).toEqual([1, 2, 5, 7]);
    expect(fusionnerExtraits([extrait, extrait]).elements).toHaveLength(4);
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

describe('couche du plan de la ville', () => {
  it('est une couche de tuiles à part, en cases de 2 × 2 tuiles (petit plan) et grands blocs, avec les teintes des îlots', () => {
    const couche = carte.layers.find((c) => c.name === COUCHE_ALENTOURS) as CoucheTuilesTiled;
    expect(couche.type).toBe('tilelayer');
    expect(couche.properties).toEqual([
      { name: 'tuiles_par_case', type: 'int', value: 2 },
      { name: 'teintes_ilots', type: 'string', value: TEINTES_ILOTS.join(',') },
    ]);
    expect(couche.chunks.every((b) => b.width === 256 && b.height === 256)).toBe(true);
    expect(decor.nomsCouches).not.toContain(COUCHE_ALENTOURS);
    expect(decor.alentours?.tuilesParCase).toBe(2);
    expect(decor.alentours?.teintesIlots).toEqual(TEINTES_ILOTS);
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
    // Boulevard (primary) : trottoirs de part et d'autre de la chaussée.
    const travers = Array.from({ length: 13 }, (_, i) => caseEn(300, -24 + 4 * i));
    expect(travers).toContain(TUILES.trottoir);
    expect(travers.indexOf(TUILES.trottoir)).toBeLessThan(travers.indexOf(TUILES.chaussee));
    expect(caseEn(200, -340)).toBe(TUILES.ilot); // chemin piéton ignoré
    expect(caseEn(120, -365)).toBe(TUILES.ilot); // bâtiment ignoré
    expect(caseEn(200, 430)).toBe(TUILES.vert);
  });

  it('couvre un carré homogène autour du parcours, sans halo, et s’arrête à son bord', () => {
    const { demiCote } = empriseDuPlan([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    // Même contenu près du parcours et loin de lui, dans les coins du carré compris.
    expect(caseEn(200 + demiCote - 20, -demiCote + 20)).toBe(TUILES.ilot);
    expect(caseEn(200 - demiCote + 20, demiCote - 20)).toBe(TUILES.ilot);
    expect(caseEn(-150, -300)).toBe(TUILES.chaussee); // rue du Nord loin dans le carré
    expect(caseEn(200, -demiCote - 30)).toBe(0);
    expect(caseEn(300, -1000)).toBe(0); // rue Lointaine hors du plan
  });
});

describe('lecture des cartes anciennes', () => {
  it('lit encore une couche des alentours de version 2 (blocs de 32 cases de 4 m, sans teintes)', async () => {
    const gids = new Uint32Array(32 * 32).fill(TUILES.pateDeMaisons);
    const octets = Buffer.alloc(gids.length * 4);
    gids.forEach((g, i) => octets.writeUInt32LE(g, i * 4));
    const couche: CoucheTuilesTiled = {
      ...(carte.layers.find((c) => c.name === COUCHE_ALENTOURS) as CoucheTuilesTiled),
      properties: [{ name: 'tuiles_par_case', type: 'int', value: 2 }],
      chunks: [-64, -32].map((x) => ({
        x,
        y: -32,
        width: 32,
        height: 32,
        data: deflateSync(octets).toString('base64'),
      })),
    };
    const ancienne = await lireDecor({
      ...carte,
      layers: carte.layers.map((c) => (c.name === COUCHE_ALENTOURS ? couche : c)),
    });
    expect(ancienne.alentours).toMatchObject({ tuilesParCase: 2, x: -64, y: -32, largeur: 64, hauteur: 32 });
    expect(ancienne.alentours!.teintesIlots).toBeUndefined();
    expect(ancienne.alentours!.gids[100]).toBe(TUILES.pateDeMaisons);
  });
});
