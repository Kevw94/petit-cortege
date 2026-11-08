/**
 * Plan de la ville autour du parcours (ADR 0008) : image à basse résolution, depuis un
 * extrait OSM plus large que la bande du décor, affichée sous le décor quand on dézoome.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COULEURS_PLAN, versTuiles, METRES_PAR_TUILE, type Parcours, type Position } from '@petit-cortege/shared';
import { genererPlan } from '../decor/plan';
import type { ExtraitOverpass } from '../decor/osm';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const osm = JSON.parse(await readFile(join(FIXTURES, 'extrait-mini.json'), 'utf8')) as ExtraitOverpass;
const parcours = (JSON.parse(await readFile(join(FIXTURES, 'parcours-mini.geojson'), 'utf8')) as { geometry: Parcours }).geometry;

const { image, plan } = genererPlan({ osm, parcours, rayonM: 120, metresParPixel: 2 });

const rvb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pixel = (x: number, y: number) => [...image.donnees.subarray((y * image.largeur + x) * 4, (y * image.largeur + x) * 4 + 4)];
/** Couleur du plan à une position [lon, lat]. */
const couleurEn = (p: Position) => {
  const t = versTuiles({ origine: plan.origine }, p);
  const k = METRES_PAR_TUILE / plan.metresParPixel;
  return pixel(Math.floor(t.x * k), Math.floor(t.y * k));
};

describe('plan de la ville autour du parcours', () => {
  it('couvre le parcours et `rayonM` autour, à la résolution demandée, coin nord-ouest en origine', () => {
    // Parcours de 400 m d'ouest en est : 400 + 2 × 120 m de large, 2 × 120 m de haut, à 2 m par pixel.
    expect(plan.metresParPixel).toBe(2);
    expect(image.largeur).toBe(plan.largeur);
    expect(image.hauteur).toBe(plan.hauteur);
    expect(plan.largeur).toBeCloseTo(320, -1);
    expect(plan.hauteur).toBeCloseTo(120, -1);
    expect(plan.origine[0]).toBeLessThan(2.36);
    expect(plan.origine[1]).toBeGreaterThan(48.87);
  });

  it('dessine les rues, les espaces verts et l’eau sur un fond d’îlots', () => {
    expect(couleurEn([2.36, 48.87])).toEqual([...rvb(COULEURS_PLAN.rue), 255]); // boulevard du parcours
    expect(couleurEn([2.36205, 48.86946])).toEqual([...rvb(COULEURS_PLAN.vert), 255]); // square
    expect(couleurEn([2.3634, 48.86941])).toEqual([...rvb(COULEURS_PLAN.eau), 255]); // bassin (multipolygone)
    expect(couleurEn([2.36478, 48.8695])).toEqual([...rvb(COULEURS_PLAN.eau), 255]); // canal
    expect(couleurEn([2.3595, 48.871])).toEqual([...rvb(COULEURS_PLAN.ilot), 255]); // entre les rues
  });

  it('les voies piétonnes se distinguent des rues ; le souterrain n’est pas dessiné', () => {
    expect(couleurEn([2.3640971, 48.8705])).toEqual([...rvb(COULEURS_PLAN.pieton), 255]);
    // Tunnel nord-sud : rien au nord du boulevard.
    expect(couleurEn([2.3627314, 48.8708])).toEqual([...rvb(COULEURS_PLAN.ilot), 255]);
  });

  it('se fond dans la couleur des îlots sur ses bords (raccord avec le sol lointain)', () => {
    // Le boulevard part 100 m avant le départ : il atteint presque le bord ouest, effacé.
    const y = Math.floor(versTuiles({ origine: plan.origine }, [2.36, 48.87]).y * (METRES_PAR_TUILE / plan.metresParPixel));
    expect(pixel(0, y)).toEqual([...rvb(COULEURS_PLAN.ilot), 255]);
    expect(pixel(plan.largeur - 1, plan.hauteur - 1)).toEqual([...rvb(COULEURS_PLAN.ilot), 255]);
  });
});
