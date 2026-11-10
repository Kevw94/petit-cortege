/**
 * Génération du décor (OSM → tilemap Tiled) sur un petit extrait fixture aux
 * coordonnées inventées : un boulevard est-ouest (le parcours le suit sur
 * 400 m), une rue résidentielle et une rue piétonne nord-sud, une route en
 * tunnel, un square, un bassin (multipolygone en deux morceaux), une boutique,
 * un bâtiment, un canal nord-sud que le boulevard franchit, des places (une
 * piétonne traversée, une `place=square` à l'arrivée, une lointaine), des arbres
 * (trottoir, chaussée, square dont un résineux, bâtiment, hors bande, une rangée).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { lireDecor, tuileEn, versTuiles, type CarteTiled, type Decor, type Parcours, type Position } from '@petit-cortege/shared';
import { genererDecor } from '../decor/carte';
import { MATERIAUX, TUILES } from '../decor/tuiles';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const lireJson = async (nom: string) => JSON.parse(await readFile(join(FIXTURES, nom), 'utf8'));

// Les coordonnées de la fixture sont en mètres autour de (2.36, 48.87), x vers l'est, y vers le sud.
const KX = 111_320 * Math.cos((48.87 * Math.PI) / 180);
const KY = 110_540;
const enPosition = (x: number, y: number): Position => [2.36 + x / KX, 48.87 - y / KY];

let carte: CarteTiled;
let decor: Decor;
/** Tuile d'une couche au point (x, y) en mètres de la fixture. */
const tuile = (couche: string, x: number, y: number) => {
  const t = versTuiles(decor.georef, enPosition(x, y));
  return tuileEn(decor, couche, Math.floor(t.x), Math.floor(t.y));
};
const sol = (x: number, y: number) => tuile('sol', x, y);

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

  it('ne dessine pas les commerces', () => {
    expect(sol(60, 15)).toBe(TUILES.ilot); // boulangerie
    expect(tuile('batiments', 60, 15)).toBe(0);
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
  const chunks = () => carte.layers.flatMap((c) => (c.type === 'tilelayer' && c.name === 'sol' ? c.chunks : []));

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

describe('bâtiments', () => {
  const toits = MATERIAUX.flatMap((m) => Object.values(m.toit));
  const murs = MATERIAUX.flatMap((m) => Object.values(m.mur).flatMap((r) => Object.values(r)));

  it('pose les bâtiments dans leur couche, au-dessus du sol : toit au nord, façade au sud', () => {
    expect(decor.nomsCouches.indexOf('batiments')).toBeGreaterThan(decor.nomsCouches.indexOf('sol'));
    expect(toits).toContain(tuile('batiments', 40, -58));
    expect(murs).toContain(tuile('batiments', 40, -31));
    expect(sol(40, -45)).toBe(TUILES.ilot);
  });

  it('ne bâtit ni sur les rues ni hors des emprises', () => {
    expect(tuile('batiments', 50, 0)).toBe(0);
    expect(tuile('batiments', 80, -45)).toBe(0);
  });

  it('perce fenêtres et porte dans une couche de détails', () => {
    const details = new Set<number>();
    for (let x = 20; x <= 60; x += 2) details.add(tuile('facades', x, -31));
    expect([...details].some((d) => MATERIAUX.some((m) => m.porte === d))).toBe(true);
  });
});

describe('ponts', () => {
  /** Tuiles de la colonne du canal (x = 350 m), du nord au sud, autour du boulevard. */
  const colonne = (couche: string) => {
    const t = versTuiles(decor.georef, enPosition(350, 0));
    const x = Math.floor(t.x);
    return Array.from({ length: 21 }, (_, i) => ({ y: Math.floor(t.y) - 10 + i, gid: tuileEn(decor, couche, x, Math.floor(t.y) - 10 + i) })).map(
      (c) => ({ ...c, x }),
    );
  };

  it('fait passer le boulevard au-dessus du canal (tablier), sans quai sous le pont', () => {
    expect(sol(350, 0)).toBe(TUILES.chaussee);
    expect(sol(350, 40)).toBe(TUILES.eau);
    const c = colonne('sol');
    const tablier = c.filter((t) => t.gid !== TUILES.eau);
    expect(tablier.length).toBeGreaterThan(5);
    expect(c.filter((t) => t.gid === TUILES.quai.haut || t.gid === TUILES.quai.bas)).toEqual([]);
  });

  it('borde le tablier de garde-corps côté eau', () => {
    const tablier = colonne('sol').filter((t) => t.gid !== TUILES.eau);
    const ponts = colonne('ponts');
    const [nord, sud] = [tablier[0]!.y, tablier[tablier.length - 1]!.y];
    expect(ponts.find((t) => t.y === nord)!.gid).toBe(TUILES.gardeCorps.nord);
    expect(ponts.find((t) => t.y === sud)!.gid).toBe(TUILES.gardeCorps.sud);
    expect(ponts.find((t) => t.y === 0 + Math.floor((nord + sud) / 2))!.gid).toBe(0);
  });

  it('ne pose pas de garde-corps hors de l’eau', () => {
    expect(tuile('ponts', 100, -8)).toBe(0);
    expect(tuile('ponts', 50, -9)).toBe(0);
  });
});

describe('noms des places traversées', () => {
  const places = () => carte.layers.flatMap((c) => (c.type === 'objectgroup' && c.name === 'places' ? c.objects : []));

  it('nomme les places que le parcours traverse, et seulement elles (ni rue, ni quartier)', () => {
    expect(places().map((p) => p.name).sort()).toEqual(['Place Test', 'Place du Milieu']);
  });

  it('marque la place d’arrivée', () => {
    const arrivee = (nom: string) => places().find((p) => p.name === nom)!.properties?.find((q) => q.name === 'arrivee')?.value;
    expect(arrivee('Place Test')).toBe(true);
    expect(arrivee('Place du Milieu')).toBe(false);
  });

  it('place le nom au centre de la place', () => {
    const t = versTuiles(decor.georef, enPosition(400, 0));
    const p = places().find((o) => o.name === 'Place Test')!;
    expect(p.x).toBeCloseTo(t.x * 16, 0);
    expect(p.y).toBeCloseTo(t.y * 16, 0);
  });

  it('est relu par le client avec le décor', () => {
    expect(decor.places).toEqual(
      expect.arrayContaining([expect.objectContaining({ nom: 'Place Test', arrivee: true }), expect.objectContaining({ nom: 'Place du Milieu', arrivee: false })]),
    );
  });
});

describe('arbres', () => {
  /** Arbres de la tilemap, en mètres de la fixture (x vers l'est, y vers le sud). */
  const arbres = () => {
    const origine = versTuiles(decor.georef, enPosition(0, 0));
    return decor.arbres.map((a) => ({ x: (a.x - origine.x) * 2, y: (a.y - origine.y) * 2, resineux: a.resineux }));
  };
  const pres = (x: number, y: number) => arbres().find((a) => Math.hypot(a.x - x, a.y - y) < 1.5);

  it('plante les arbres OSM sur le trottoir et dans le square, résineux compris', () => {
    expect(pres(60, -8)).toMatchObject({ resineux: false });
    expect(pres(150, 60)).toMatchObject({ resineux: false });
    expect(pres(170, 75)).toMatchObject({ resineux: true });
  });

  it('plante une rangée d’arbres (`tree_row`) tous les 10 m', () => {
    const rangee = arbres().filter((a) => Math.abs(a.y + 80) < 1.5 && a.x > 195 && a.x < 265);
    expect(rangee.map((a) => Math.round(a.x))).toEqual([200, 210, 220, 230, 240, 250, 260]);
  });

  it('ne plante rien sur la chaussée, dans un bâtiment, hors de la bande', () => {
    expect(pres(100, -50)).toBeUndefined();
    expect(pres(40, -45)).toBeUndefined();
    expect(pres(60, -150)).toBeUndefined();
  });

  it('laisse le passage du cortège libre : aucun arbre à moins de 6 m du parcours', () => {
    // Le parcours suit le boulevard (y = 0) de x = 0 à x = 400.
    for (const a of arbres()) if (a.x >= 0 && a.x <= 400) expect(Math.abs(a.y)).toBeGreaterThanOrEqual(6);
  });
});
