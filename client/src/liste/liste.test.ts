import { describe, expect, it } from 'vitest';
import type { Parcours } from '@petit-cortege/shared';
import { etatDeLaManif, traceMiniature } from './liste';

const MANIF = { depart: '2026-11-08T14:00:00.000Z', fin: '2026-11-08T16:30:00.000Z' };
const a = (iso: string) => new Date(iso);

describe('état d’une manif, en mots, pour la liste', () => {
  it.each([
    ['2026-11-08T13:48:00Z', 'Départ dans 12 min', 'avant'],
    ['2026-11-08T13:59:40Z', 'Départ dans 1 min', 'avant'],
    ['2026-11-08T11:30:00Z', 'Départ dans 2 h 30', 'avant'],
    ['2026-11-08T13:00:00Z', 'Départ dans 1 h', 'avant'],
    ['2026-11-08T14:00:00Z', 'En marche depuis 0 min', 'en-marche'],
    ['2026-11-08T14:20:30Z', 'En marche depuis 20 min', 'en-marche'],
    ['2026-11-08T15:05:00Z', 'En marche depuis 1 h 05', 'en-marche'],
    ['2026-11-08T16:30:00Z', 'Terminée', 'terminee'],
  ])('à %s : « %s »', (maintenant, texte, phase) => {
    expect(etatDeLaManif(MANIF, a(maintenant))).toEqual({ texte, phase });
  });
});

describe('miniature du parcours', () => {
  // Parcours en L : 1 km vers l'est puis 500 m vers le nord, à la latitude de Paris.
  const parcours: Parcours = {
    type: 'LineString',
    coordinates: [
      [2.35, 48.85],
      [2.363653, 48.85],
      [2.363653, 48.854523],
    ],
  };

  it('tient dans le cadre en gardant les proportions, nord en haut, avec une marge', () => {
    const { points } = traceMiniature(parcours, { largeur: 120, hauteur: 80, marge: 10 });
    // 1000 × 500 m dans 100 × 60 utiles : l'échelle est fixée par la largeur (0,1 px/m), centré en hauteur.
    expect(points[0]!.x).toBeCloseTo(10, 0);
    expect(points[1]!.x).toBeCloseTo(110, 0);
    expect(points[0]!.y).toBeCloseTo(65, 0);
    expect(points[2]!.y).toBeCloseTo(15, 0);
    expect(points[2]!.x).toBeCloseTo(110, 0);
  });

  it('donne le chemin SVG et sa longueur (pour l’animation du tracé)', () => {
    const { d, longueur } = traceMiniature(parcours, { largeur: 120, hauteur: 80, marge: 10 });
    expect(d).toMatch(/^M10(\.0)? 65(\.0)? L110(\.0)? 65(\.0)? L110(\.0)? 15(\.0)?$/);
    expect(longueur).toBeCloseTo(150, 0);
  });

  it('un parcours réduit à un point reste au centre', () => {
    const { points } = traceMiniature({ type: 'LineString', coordinates: [[2.35, 48.85], [2.35, 48.85]] }, { largeur: 100, hauteur: 50, marge: 5 });
    expect(points[0]).toEqual({ x: 50, y: 25 });
  });
});
