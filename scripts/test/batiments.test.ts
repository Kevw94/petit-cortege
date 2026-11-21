/**
 * Autotiling des emprises de bâtiments OSM (polygones quelconques, en tuiles)
 * vers les pièces de bâtiment Kenney en vue 3/4 : toit en 9 morceaux, façade
 * sur le bord sud, matériau tiré par bâtiment.
 */
import { describe, expect, it } from 'vitest';
import type { PointTuiles } from '@petit-cortege/shared';
import { autotilerBatiments, materiauDe, type Emprise } from '../decor/batiments';
import { MATERIAUX, type Materiau } from '../decor/tuiles';

const LARGEUR = 24;
const HAUTEUR = 20;
const partout = () => true;

const rectangle = (x0: number, y0: number, x1: number, y1: number): PointTuiles[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
];

function autotiler(emprises: Emprise[], constructible: (x: number, y: number) => boolean = partout) {
  const b = autotilerBatiments({ largeur: LARGEUR, hauteur: HAUTEUR, emprises, constructible });
  const piece = (x: number, y: number) => b.batiments[y * LARGEUR + x]!;
  const detail = (x: number, y: number) => b.facades[y * LARGEUR + x]!;
  return { ...b, piece, detail };
}

const piecesDeMur = (m: Materiau) => Object.values(m.mur).flatMap((r) => Object.values(r));
const piecesDeToit = (m: Materiau) => Object.values(m.toit);
const piecesDe = (m: Materiau) => [...piecesDeToit(m), ...piecesDeMur(m)];

describe('rectangle', () => {
  // Tuiles 2 à 11 en x, 2 à 9 en y : 10 × 8 tuiles.
  const r = autotiler([{ id: 'way/1', anneaux: [rectangle(2, 2, 12, 10)] }]);
  const m = materiauDe('way/1');

  it('couvre exactement l’emprise, dans le matériau du bâtiment', () => {
    for (let y = 0; y < HAUTEUR; y++) {
      for (let x = 0; x < LARGEUR; x++) {
        const dedans = x >= 2 && x <= 11 && y >= 2 && y <= 9;
        expect(r.piece(x, y) !== 0, `(${x}, ${y})`).toBe(dedans);
        if (dedans) expect(piecesDe(m)).toContain(r.piece(x, y));
      }
    }
  });

  it('pose un toit en 9 morceaux au-dessus de la façade', () => {
    expect(r.piece(2, 2)).toBe(m.toit.hautGauche);
    expect(r.piece(6, 2)).toBe(m.toit.haut);
    expect(r.piece(11, 2)).toBe(m.toit.hautDroite);
    expect(r.piece(2, 4)).toBe(m.toit.gauche);
    expect(r.piece(6, 4)).toBe(m.toit.plein);
    expect(r.piece(11, 4)).toBe(m.toit.droite);
    expect(r.piece(2, 6)).toBe(m.toit.basGauche);
    expect(r.piece(6, 6)).toBe(m.toit.bas);
    expect(r.piece(11, 6)).toBe(m.toit.basDroite);
  });

  it('dresse une façade de trois rangées sur le bord sud', () => {
    expect([r.piece(2, 7), r.piece(6, 7), r.piece(11, 7)]).toEqual([
      m.mur.haut.gauche,
      m.mur.haut.milieu,
      m.mur.haut.droite,
    ]);
    expect([r.piece(2, 8), r.piece(6, 8), r.piece(11, 8)]).toEqual([
      m.mur.milieu.gauche,
      m.mur.milieu.milieu,
      m.mur.milieu.droite,
    ]);
    expect([r.piece(2, 9), r.piece(6, 9), r.piece(11, 9)]).toEqual([
      m.mur.bas.gauche,
      m.mur.bas.milieu,
      m.mur.bas.droite,
    ]);
  });

  it('perce des fenêtres dans la façade et une porte au rez-de-chaussée, rien sur le toit', () => {
    const details = (y: number) => Array.from({ length: 10 }, (_, i) => r.detail(2 + i, y));
    expect(details(7)).toContain(m.fenetre);
    expect(details(8)).toContain(m.fenetre);
    expect(details(9).filter((d) => d === m.porte)).toHaveLength(1);
    for (let y = 0; y < 7; y++) for (let x = 0; x < LARGEUR; x++) expect(r.detail(x, y)).toBe(0);
  });
});

describe('L', () => {
  // Aile verticale : x 2 à 5, y 2 à 13 ; aile horizontale : x 2 à 13, y 10 à 13.
  const l = [
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    { x: 6, y: 10 },
    { x: 14, y: 10 },
    { x: 14, y: 14 },
    { x: 2, y: 14 },
    { x: 2, y: 2 },
  ];
  const r = autotiler([{ id: 'way/2', anneaux: [l] }]);
  const m = materiauDe('way/2');

  it('dessine le coin rentrant du toit', () => {
    expect(r.piece(5, 10)).toBe(m.toit.creuxHautDroite);
    expect(r.piece(6, 10)).toBe(m.toit.haut);
    expect(r.piece(5, 9)).toBe(m.toit.droite);
    expect(r.piece(13, 10)).toBe(m.toit.hautDroite);
  });

  it('court d’une seule façade le long du bord sud, à hauteur constante', () => {
    // L'aile horizontale ne fait que 4 tuiles de profondeur : 2 rangées de façade, 2 de toit.
    for (let x = 2; x <= 13; x++) {
      expect(piecesDeMur(m), `(${x}, 12)`).toContain(r.piece(x, 12));
      expect(piecesDeMur(m), `(${x}, 13)`).toContain(r.piece(x, 13));
      expect(piecesDeToit(m), `(${x}, 11)`).toContain(r.piece(x, 11));
    }
    expect(r.piece(2, 13)).toBe(m.mur.bas.gauche);
    expect(r.piece(13, 12)).toBe(m.mur.haut.droite);
  });
});

describe('cour intérieure', () => {
  // Bâtiment x 2 à 15, y 2 à 13, autour d'une cour x 6 à 11, y 6 à 9.
  const r = autotiler([{ id: 'way/3', anneaux: [rectangle(2, 2, 16, 14), rectangle(6, 6, 12, 10)] }]);
  const m = materiauDe('way/3');

  it('laisse la cour libre', () => {
    for (let y = 6; y <= 9; y++) for (let x = 6; x <= 11; x++) expect(r.piece(x, y)).toBe(0);
  });

  it('borde la cour de toit, avec une façade côté nord de la cour (tournée vers le sud)', () => {
    expect(r.piece(8, 5)).toBe(m.mur.bas.milieu);
    expect(r.piece(8, 4)).toBe(m.mur.haut.milieu);
    expect(r.piece(8, 3)).toBe(m.toit.bas);
    expect(r.piece(8, 10)).toBe(m.toit.haut);
    expect(r.piece(5, 8)).toBe(m.toit.droite);
    expect(r.piece(12, 8)).toBe(m.toit.gauche);
    expect(r.piece(8, 13)).toBe(m.mur.bas.milieu);
  });
});

describe('polygone en biais', () => {
  // Rectangle de 14 × 7 tuiles tourné de 30°.
  const [cx, cy, a] = [12, 10, Math.PI / 6];
  const coin = (u: number, v: number) => ({
    x: cx + u * Math.cos(a) - v * Math.sin(a),
    y: cy + u * Math.sin(a) + v * Math.cos(a),
  });
  const biais = [coin(-7, -3.5), coin(7, -3.5), coin(7, 3.5), coin(-7, 3.5), coin(-7, -3.5)];
  const r = autotiler([{ id: 'way/4', anneaux: [biais] }]);
  const m = materiauDe('way/4');
  const tuiles = () => {
    const t: { x: number; y: number }[] = [];
    for (let y = 0; y < HAUTEUR; y++) for (let x = 0; x < LARGEUR; x++) if (r.piece(x, y) !== 0) t.push({ x, y });
    return t;
  };
  const dedans = ({ x, y }: { x: number; y: number }) => {
    const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
    const u = dx * Math.cos(a) + dy * Math.sin(a);
    const v = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= 7 && Math.abs(v) <= 3.5;
  };

  it('reste dans l’emprise et en couvre l’essentiel, dans le matériau du bâtiment', () => {
    const t = tuiles();
    expect(t.length).toBeGreaterThan(0.75 * 14 * 7);
    for (const p of t) {
      expect(dedans(p), `(${p.x}, ${p.y})`).toBe(true);
      expect(piecesDe(m)).toContain(r.piece(p.x, p.y));
    }
  });

  it('pose une façade (soubassement) au pied de chaque colonne, et un toit au sommet', () => {
    const colonnes = new Set(tuiles().map((p) => p.x));
    const basses = [m.mur.bas, m.mur.unique].flatMap((rangee) => Object.values(rangee));
    let avecFacade = 0;
    for (const x of colonnes) {
      const ys = tuiles()
        .filter((p) => p.x === x)
        .map((p) => p.y);
      expect(piecesDeToit(m)).toContain(r.piece(x, Math.min(...ys)));
      if (basses.includes(r.piece(x, Math.max(...ys)))) avecFacade++;
    }
    expect(avecFacade).toBeGreaterThan(0.75 * colonnes.size);
  });
});

describe('emprise et sol', () => {
  it('ne bâtit pas sur une rue qui traverse l’emprise : la façade donne sur la rue', () => {
    const r = autotiler([{ id: 'way/1', anneaux: [rectangle(2, 2, 12, 16)] }], (_x, y) => y !== 10);
    const m = materiauDe('way/1');
    for (let x = 2; x <= 11; x++) expect(r.piece(x, 10)).toBe(0);
    expect(r.piece(6, 9)).toBe(m.mur.bas.milieu);
    expect(r.piece(6, 11)).toBe(m.toit.haut);
  });

  it('ignore les morceaux d’une tuile de large', () => {
    const r = autotiler([{ id: 'way/1', anneaux: [rectangle(2, 2, 3, 12)] }]);
    expect(r.batiments.every((g) => g === 0)).toBe(true);
  });

  it('dessine chaque bâtiment de deux bâtiments mitoyens avec ses propres bords', () => {
    const r = autotiler([
      { id: 'way/5', anneaux: [rectangle(2, 2, 8, 10)] },
      { id: 'way/6', anneaux: [rectangle(8, 2, 14, 10)] },
    ]);
    expect(r.piece(7, 2)).toBe(materiauDe('way/5').toit.hautDroite);
    expect(r.piece(8, 2)).toBe(materiauDe('way/6').toit.hautGauche);
  });
});

describe('matériaux', () => {
  it('tire le matériau d’un bâtiment de son identifiant : toujours le même, et variés d’un bâtiment à l’autre', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `way/${1000 + i}`);
    expect(ids.map(materiauDe)).toEqual(ids.map(materiauDe));
    expect(new Set(ids.map((id) => materiauDe(id).nom)).size).toBeGreaterThanOrEqual(3);
    expect(MATERIAUX.length).toBeGreaterThanOrEqual(3);
  });

  it('produit la même sortie pour la même entrée', () => {
    const emprises = [{ id: 'way/7', anneaux: [rectangle(2, 2, 12, 10)] }];
    const a = autotiler(emprises);
    const b = autotiler(emprises);
    expect(a.batiments).toEqual(b.batiments);
    expect(a.facades).toEqual(b.facades);
  });
});
