/**
 * Génération du décor (OSM → tilemap Tiled) sur un petit extrait fixture aux
 * coordonnées inventées : un boulevard est-ouest (le parcours le suit sur
 * 400 m), une rue résidentielle et une rue piétonne nord-sud, une route en
 * tunnel, un square, un bassin (multipolygone en deux morceaux), une boutique.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { lireDecor, tuileEn, versTuiles, type CarteTiled, type Decor, type Parcours, type Position } from '@petit-cortege/shared';
import { genererDecor } from '../decor/carte';
import { TUILES } from '../decor/tuiles';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const lireJson = async (nom: string) => JSON.parse(await readFile(join(FIXTURES, nom), 'utf8'));

// Les coordonnées de la fixture sont en mètres autour de (2.36, 48.87), x vers l'est, y vers le sud.
const KX = 111_320 * Math.cos((48.87 * Math.PI) / 180);
const KY = 110_540;
const enPosition = (x: number, y: number): Position => [2.36 + x / KX, 48.87 - y / KY];

let carte: CarteTiled;
let decor: Decor;
/** Tuile de la couche « sol » au point (x, y) en mètres de la fixture. */
const sol = (x: number, y: number) => {
  const t = versTuiles(decor.georef, enPosition(x, y));
  return tuileEn(decor, 'sol', Math.floor(t.x), Math.floor(t.y));
};

beforeAll(async () => {
  const osm = await lireJson('extrait-mini.json');
  const parcours: Parcours = (await lireJson('parcours-mini.geojson')).geometry;
  carte = genererDecor({ osm, parcours, demiLargeurM: 100 });
  decor = await lireDecor(carte);
});

describe('tilemap Tiled', () => {
  it('est une carte Tiled infinie à tuiles de 16 px, avec les tilesets Kenney', () => {
    expect(carte).toMatchObject({ type: 'map', orientation: 'orthogonal', infinite: true, tilewidth: 16, tileheight: 16 });
    expect(carte.tilesets.map((t) => t.name)).toEqual(['roguelikeCity', 'roguelikeSheet']);
  });

  it('porte la licence ODbL et la mention des contributeurs d’OpenStreetMap', () => {
    const proprietes = Object.fromEntries(carte.properties.map((p) => [p.name, p.value]));
    expect(proprietes.licence).toMatch(/ODbL/);
    expect(proprietes.attribution).toBe('© les contributeurs d’OpenStreetMap');
  });
});

describe('rues selon leur type', () => {
  it('pose de l’asphalte sur la chaussée du boulevard', () => {
    expect(sol(50, 0)).toBe(TUILES.chaussee);
  });

  it('donne au boulevard (primary) une chaussée et des trottoirs plus larges qu’à une rue résidentielle', () => {
    // Boulevard : chaussée de 12 m, trottoirs de 4 m.
    expect(sol(50, 3)).toBe(TUILES.chaussee);
    expect(sol(50, 8)).toBe(TUILES.trottoir);
    expect(sol(50, 14)).toBe(TUILES.ilot);
    // Rue résidentielle : chaussée de 6 m, trottoirs de 3 m.
    expect(sol(101, -60)).toBe(TUILES.chaussee);
    expect(sol(103, -60)).not.toBe(TUILES.chaussee);
    expect(sol(104.5, -60)).toBe(TUILES.trottoir);
    expect(sol(109, -60)).toBe(TUILES.ilot);
  });

  it('dessine la bordure du trottoir qui surplombe la chaussée (vue 3/4)', () => {
    const t = versTuiles(decor.georef, enPosition(50, 0));
    const [x, y] = [Math.floor(t.x), Math.floor(t.y)];
    let haut = y;
    while (tuileEn(decor, 'sol', x, haut) === TUILES.chaussee) haut--;
    let bas = y;
    while (tuileEn(decor, 'sol', x, bas) === TUILES.chaussee) bas++;
    expect(tuileEn(decor, 'sol', x, haut)).toBe(TUILES.trottoirBordure);
    expect(tuileEn(decor, 'sol', x, bas)).toBe(TUILES.trottoir);
  });

  it('dalle les rues piétonnes', () => {
    expect(sol(300, 50)).toBe(TUILES.pieton);
    expect(sol(300, -50)).toBe(TUILES.pieton);
  });

  it('ignore les rues en tunnel', () => {
    expect(sol(200, 60)).toBe(TUILES.ilot);
    expect(sol(200, -60)).toBe(TUILES.ilot);
  });
});

describe('espaces verts, eau, et rien d’autre', () => {
  it('engazonne le square', () => {
    expect(sol(150, 60)).toBe(TUILES.vert);
  });

  it('remplit d’eau le bassin (multipolygone en deux morceaux) et le borde de quais', () => {
    expect(sol(250, 65)).toBe(TUILES.eau);
    expect(sol(250, 40.5)).toBe(TUILES.quai.haut);
    expect(sol(250, 89.5)).toBe(TUILES.quai.bas);
    expect(sol(220.5, 65)).toBe(TUILES.quai.gauche);
  });

  it('ne dessine ni commerce ni bâtiment (en attendant les bâtiments, #13)', () => {
    expect(sol(60, 15)).toBe(TUILES.ilot); // boulangerie
    expect(sol(40, -45)).toBe(TUILES.ilot); // emprise de bâtiment
  });

  it('ne dessine rien hors de la bande de 100 m de part et d’autre du parcours', () => {
    expect(sol(50, 95)).toBe(TUILES.ilot);
    expect(sol(50, 106)).toBe(0);
    expect(sol(50, -106)).toBe(0);
    expect(sol(-106, 0)).toBe(0);
    expect(sol(150, 120)).toBe(0); // le square déborde de la bande : coupé
  });
});

describe('découpage en blocs', () => {
  const chunks = () => carte.layers.flatMap((c) => (c.type === 'tilelayer' ? c.chunks : []));

  it('découpe la couche en blocs de 32 × 32 tuiles alignés', () => {
    expect(chunks().length).toBeGreaterThan(1);
    for (const c of chunks()) {
      expect(c).toMatchObject({ width: 32, height: 32 });
      expect(c.x % 32).toBe(0);
      expect(c.y % 32).toBe(0);
    }
  });

  it('omet les blocs entièrement hors de la bande', () => {
    // Bande de 600 m × 200 m aux bouts arrondis : les blocs des quatre coins de l'emprise sont vides.
    const emprise = Math.ceil(carte.width / 32) * Math.ceil(carte.height / 32);
    expect(decor.blocs.size).toBe(chunks().length);
    expect(decor.blocs.size).toBeLessThan(emprise);
    for (const bloc of decor.blocs.values()) expect(bloc.couches.sol!.some((gid) => gid !== 0)).toBe(true);
  });
});

describe('tracé du parcours (couche d’objets)', () => {
  const objets = () => carte.layers.flatMap((c) => (c.type === 'objectgroup' && c.name === 'parcours' ? c.objects : []));
  const enPixels = (x: number, y: number) => {
    const t = versTuiles(decor.georef, enPosition(x, y));
    return { x: t.x * 16, y: t.y * 16 };
  };

  it('place le départ et l’arrivée aux extrémités du parcours', () => {
    const depart = objets().find((o) => o.name === 'depart')!;
    const arrivee = objets().find((o) => o.name === 'arrivee')!;
    expect(depart.x).toBeCloseTo(enPixels(0, 0).x, 1);
    expect(depart.y).toBeCloseTo(enPixels(0, 0).y, 1);
    expect(arrivee.x).toBeCloseTo(enPixels(400, 0).x, 1);
    expect(arrivee.rotation).toBeCloseTo(0, 6); // vers l'est
  });

  it('pose une flèche tous les 50 m dans le sens de marche', () => {
    const fleches = objets().filter((o) => o.name === 'fleche');
    expect(fleches).toHaveLength(7); // 50, 100, … 350 m
    expect(fleches[0]!.x).toBeCloseTo(enPixels(50, 0).x, 1);
    for (const f of fleches) expect(f.rotation).toBeCloseTo(0, 6);
  });

  it('trace la ligne du parcours en polyligne', () => {
    const trace = objets().find((o) => o.name === 'trace')!;
    expect(trace.polyline).toHaveLength(2);
    expect(trace.x + trace.polyline![1]!.x).toBeCloseTo(enPixels(400, 0).x, 1);
  });
});
