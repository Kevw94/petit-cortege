import { describe, expect, it } from 'vitest';
import { allureDArbre, arbresAPlanter, VARIANTES_ARBRE } from './arbres';

/** Une rangée d'arbres feuillus, un tous les 5 m. */
const rangee = Array.from({ length: 400 }, (_, i) => ({ x: i * 2.5, y: 10, resineux: false }));
const part = (date: string, variante: (typeof VARIANTES_ARBRE)[number]) =>
  rangee.filter((a) => allureDArbre(a, new Date(date)).variante === variante).length / rangee.length;

describe('allure d’un arbre', () => {
  it('est la même pour le même arbre, chez tout le monde', () => {
    const a = { x: 12.5, y: 40, resineux: false };
    expect(allureDArbre(a, new Date('2026-11-10T12:00:00Z'))).toEqual(allureDArbre({ ...a }, new Date('2026-11-10T18:00:00Z')));
  });

  it('en été, tous les feuillus sont verts', () => {
    expect(part('2026-07-14T12:00:00Z', 'feuillu-roux')).toBe(0);
  });

  it('en novembre, la plupart des feuillus ont roussi ; un peu en septembre', () => {
    expect(part('2026-11-10T12:00:00Z', 'feuillu-roux')).toBeGreaterThan(0.5);
    const septembre = part('2026-09-20T12:00:00Z', 'feuillu-roux');
    expect(septembre).toBeGreaterThan(0);
    expect(septembre).toBeLessThan(0.3);
  });

  it('un résineux reste un conifère vert en toute saison', () => {
    for (const date of ['2026-01-15', '2026-07-14', '2026-11-10']) {
      expect(allureDArbre({ x: 3, y: 4, resineux: true }, new Date(date)).variante).toMatch(/^conifere/);
    }
  });

  it('varie un peu de taille d’un arbre à l’autre (entre 85 % et 115 %)', () => {
    const tailles = rangee.map((a) => allureDArbre(a, new Date('2026-07-14')).echelle);
    expect(Math.min(...tailles)).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...tailles)).toBeLessThanOrEqual(1.15);
    expect(new Set(tailles.map((t) => t.toFixed(2))).size).toBeGreaterThan(10);
  });
});

describe('arbres à planter', () => {
  it('pied en mètres (tuile de 2 m), taille selon l’allure, case de la planche de la variante', () => {
    const date = new Date('2026-07-14T12:00:00Z');
    const arbre = { x: 10, y: 20.5, resineux: true };
    const [plante] = arbresAPlanter([arbre], date);
    const { variante, echelle } = allureDArbre(arbre, date);
    expect(plante).toEqual({
      pied: { x: 20, y: 41 },
      largeurM: 6 * echelle,
      hauteurM: 12 * echelle,
      cadre: { x: VARIANTES_ARBRE.indexOf(variante) * 16, y: 0, largeur: 16, hauteur: 32 },
    });
  });
});
