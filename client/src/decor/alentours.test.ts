import { describe, expect, it } from 'vitest';
import {
  ASPECT_ECRAN_MAX,
  ASPECT_ECRAN_MIN,
  empriseDuPlan,
  FONDU_PLAN_M,
  MARGE_RAYON_VUE_DE_HAUT_M,
} from '@petit-cortege/shared';
import { cadrerSur } from '../cadrage';
import { CHAMP_VERTICAL_DEG, distancePourToutVoir } from '../vue3d/camera3d';
import { distancesAuVide, echelleMinDansLePlan, partDeLaCase, teintesDesIlots } from './alentours';

describe('fondu au bord des alentours', () => {
  it('mesure la distance de chaque case au vide, l’extérieur de la grille comptant comme vide', () => {
    // 5 × 3 : une case vide au milieu de la rangée du haut.
    const gids = new Uint32Array([1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const d = distancesAuVide(gids, 5, 3);
    expect(d[2]).toBe(0);
    expect(d[7]).toBe(1); // juste sous la case vide
    expect(d[0]).toBe(1); // au bord de la grille
    expect(d[12]).toBe(1);
  });

  it('va du fond (bord) à la couleur propre de la case (au-delà du fondu), sans palier', () => {
    expect(partDeLaCase(0, 30)).toBe(0);
    expect(partDeLaCase(15, 30)).toBeCloseTo(0.5);
    expect(partDeLaCase(30, 30)).toBe(1);
    expect(partDeLaCase(1000, 30)).toBe(1);
    expect(partDeLaCase(10, 30)).toBeLessThan(partDeLaCase(11, 30));
  });
});

describe('teintes des îlots', () => {
  it('donne une seule teinte par îlot (cases contiguës), de façon déterministe, et varie d’un îlot à l’autre', () => {
    // 6 × 6 : rues (2) en croix, quatre îlots (1) de 2 × 2... et 0 au bord.
    const L = 31;
    const gids = new Uint32Array(L * L).fill(1);
    for (let i = 0; i < L; i++) {
      for (const k of [5, 11, 17, 23, 29]) {
        gids[k * L + i] = 2;
        gids[i * L + k] = 2;
      }
    }
    const t = teintesDesIlots(gids, L, 1, 3);
    expect(t[5 * L + 2]).toBe(-1); // rue
    expect(new Set([t[0], t[1], t[L], t[4 * L + 4]]).size).toBe(1); // même îlot
    const parIlot = [0, 6, 12, 18, 24].flatMap((y) => [0, 6, 12, 18, 24].map((x) => t[y * L + x]!));
    expect(new Set(parIlot)).toEqual(new Set([0, 1, 2]));
    expect(teintesDesIlots(gids, L, 1, 3)).toEqual(t);
  });
});

/** Formats d'écran couverts : portrait 9:19,5, 16:10, 16:9, 21:9, et quelques tailles réelles. */
const ECRANS = [
  { largeur: 390, hauteur: 844 },
  { largeur: 360, hauteur: 780 },
  { largeur: 768, hauteur: 1024 },
  { largeur: 1280, hauteur: 800 },
  { largeur: 1920, hauteur: 1080 },
  { largeur: 2560, hauteur: 1080 },
  { largeur: 844, hauteur: 390 },
];
/** Parcours (m) : défilé parisien d'est en ouest, nord-sud, en coude, et petit parcours. */
const PARCOURS = [
  [
    { x: 0, y: 0 },
    { x: 3100, y: 1300 },
  ],
  [
    { x: 0, y: 0 },
    { x: 200, y: 2800 },
  ],
  [
    { x: 0, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 1500 },
  ],
  [
    { x: 0, y: 0 },
    { x: 600, y: 300 },
  ],
];

describe('emprise du plan au dézoom maximal', () => {
  it('couvre les formats d’écran essayés', () => {
    expect(ASPECT_ECRAN_MIN).toBeLessThanOrEqual(Math.min(...ECRANS.map((e) => e.largeur / e.hauteur)));
    expect(ASPECT_ECRAN_MAX).toBeGreaterThanOrEqual(Math.max(...ECRANS.map((e) => e.largeur / e.hauteur)));
  });

  it('3D : l’écran entier, quelle que soit l’orientation de la caméra, reste dans la partie nette du plan', () => {
    for (const points of PARCOURS) {
      const { centre, demiCote } = empriseDuPlan(points);
      const rayon =
        Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) + MARGE_RAYON_VUE_DE_HAUT_M;
      for (const e of ECRANS) {
        const aspect = e.largeur / e.hauteur;
        const distance = distancePourToutVoir(rayon, CHAMP_VERTICAL_DEG, aspect);
        const demiH = distance * Math.tan((CHAMP_VERTICAL_DEG * Math.PI) / 360);
        const demiDiagonale = Math.hypot(demiH, demiH * aspect);
        expect(demiDiagonale).toBeLessThanOrEqual(demiCote - FONDU_PLAN_M);
      }
    }
  });

  it('2D : le dézoom maximal, borné au plan, garde l’écran dans sa partie nette sans empêcher la vue d’ensemble', () => {
    for (const points of PARCOURS) {
      const { centre, demiCote } = empriseDuPlan(points);
      const net = {
        minX: centre.x - demiCote + FONDU_PLAN_M,
        maxX: centre.x + demiCote - FONDU_PLAN_M,
        minY: centre.y - demiCote + FONDU_PLAN_M,
        maxY: centre.y + demiCote - FONDU_PLAN_M,
      };
      const emprise = {
        minX: Math.min(...points.map((p) => p.x)),
        maxX: Math.max(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxY: Math.max(...points.map((p) => p.y)),
      };
      for (const e of ECRANS) {
        const ensemble = cadrerSur(emprise, e, 32);
        const echelleMin = Math.max(
          ensemble.echelleMin,
          echelleMinDansLePlan(net, ensemble.centre, e, ensemble.echelle),
        );
        expect(echelleMin).toBeLessThanOrEqual(ensemble.echelle);
        expect(e.largeur / echelleMin / 2).toBeLessThanOrEqual(net.maxX - ensemble.centre.x + 1e-6);
        expect(e.hauteur / echelleMin / 2).toBeLessThanOrEqual(net.maxY - ensemble.centre.y + 1e-6);
      }
    }
  });
});
