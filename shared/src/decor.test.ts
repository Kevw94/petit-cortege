import { describe, expect, it } from 'vitest';
import {
  decorDuParcours,
  ecartAuTraceDuDecor,
  tracerParcours,
  versPosition,
  versTuiles,
  type EntreeIndexDecors,
  type Georeference,
  type IndexDecors,
} from './decor';
import type { Position } from './format';

// Origine du décor : coin haut-gauche de la tuile (0, 0), à Paris.
const geo: Georeference = { origine: [2.36, 48.87] };
// Mètres par degré à 48,87° de latitude (projection locale équirectangulaire).
const M_PAR_DEG_LON = 111_320 * Math.cos((48.87 * Math.PI) / 180); // ≈ 73 240 m
const M_PAR_DEG_LAT = 110_540;

describe('projection du décor (tuile de 16 px ≈ 2 m)', () => {
  it("place l'origine au coin de la tuile (0, 0)", () => {
    expect(versTuiles(geo, [2.36, 48.87])).toEqual({ x: 0, y: 0 });
  });

  it("compte une tuile tous les 2 m vers l'est et vers le sud", () => {
    const p = versTuiles(geo, [2.36 + 20 / M_PAR_DEG_LON, 48.87 - 100 / M_PAR_DEG_LAT]);
    expect(p.x).toBeCloseTo(10, 6); // 20 m à l'est
    expect(p.y).toBeCloseTo(50, 6); // 100 m au sud (y vers le bas)
  });

  it('retrouve la position géographique d’une tuile', () => {
    const [lon, lat] = versPosition(geo, { x: 10, y: 50 });
    expect(lon).toBeCloseTo(2.36 + 20 / M_PAR_DEG_LON, 9);
    expect(lat).toBeCloseTo(48.87 - 100 / M_PAR_DEG_LAT, 9);
  });
});

describe('tracé du parcours au sol', () => {
  it('pose le départ au premier point et l’arrivée au dernier, orientés dans le sens de marche', () => {
    const trace = tracerParcours(
      [
        { x: 10, y: 5 },
        { x: 110, y: 5 },
      ],
      { espacementFleches: 25 },
    );
    expect(trace.ligne).toEqual([
      { x: 10, y: 5 },
      { x: 110, y: 5 },
    ]);
    expect(trace.depart).toEqual({ x: 10, y: 5, angle: 0 });
    expect(trace.arrivee).toEqual({ x: 110, y: 5, angle: 0 });
  });

  it('pose une flèche à intervalles réguliers, ni sur le départ ni sur l’arrivée', () => {
    const trace = tracerParcours(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { espacementFleches: 25 },
    );
    expect(trace.fleches).toEqual([
      { x: 25, y: 0, angle: 0 },
      { x: 50, y: 0, angle: 0 },
      { x: 75, y: 0, angle: 0 },
    ]);
  });

  it('oriente les flèches selon le tronçon où elles tombent (angle en degrés, sens horaire, y vers le bas)', () => {
    // 30 tuiles vers l'est puis 30 vers le sud.
    const trace = tracerParcours(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
      ],
      { espacementFleches: 20 },
    );
    expect(trace.fleches).toEqual([
      { x: 20, y: 0, angle: 0 },
      { x: 30, y: 10, angle: 90 },
    ]);
    expect(trace.arrivee.angle).toBe(90);
  });
});

describe('choix du décor qui couvre le parcours', () => {
  // Deux décors de République à Nation : l'un par le boulevard Voltaire (en diagonale),
  // l'autre par la Bastille. Les deux emprises contiennent la place de la Bastille.
  const republique: Position = [2.3639, 48.8673];
  const bastille: Position = [2.3695, 48.8533];
  const nation: Position = [2.3961, 48.8483];
  const voltaire: EntreeIndexDecors = {
    fichier: 'republique-nation.json',
    emprise: [2.363, 48.847, 2.397, 48.868],
    trace: [republique, nation],
    demiLargeurM: 100,
  };
  const parBastille: EntreeIndexDecors = {
    fichier: 'paris-2026-11-14.json',
    emprise: [2.363, 48.847, 2.397, 48.868],
    trace: [republique, bastille, nation],
    demiLargeurM: 100,
  };
  const index: IndexDecors = { v: 1, decors: [voltaire, parBastille] };

  it('prend le décor dont la bande couvre le parcours, pas le premier dont l’emprise le contient', () => {
    expect(decorDuParcours(index, [republique, bastille, nation])?.fichier).toBe('paris-2026-11-14.json');
    expect(decorDuParcours(index, [republique, nation])?.fichier).toBe('republique-nation.json');
  });

  it('mesure l’écart sur tout le parcours, pas seulement ses sommets', () => {
    expect(ecartAuTraceDuDecor(voltaire, [republique, bastille, nation])).toBeGreaterThan(500);
    expect(ecartAuTraceDuDecor(parBastille, [republique, bastille, nation])).toBeLessThan(1);
    // Parcours direct République → Nation : ses sommets sont sur le tracé par la Bastille, pas son milieu.
    expect(ecartAuTraceDuDecor(parBastille, [republique, nation])).toBeGreaterThan(500);
  });

  it('se rabat sur un décor d’index ancien (sans tracé) faute de mieux, sinon aucun', () => {
    const ancien: EntreeIndexDecors = { fichier: 'ancien.json', emprise: [2.363, 48.847, 2.397, 48.868] };
    expect(decorDuParcours({ v: 1, decors: [voltaire, ancien] }, [republique, bastille, nation])?.fichier).toBe(
      'ancien.json',
    );
    expect(decorDuParcours({ v: 1, decors: [voltaire] }, [republique, bastille, nation])).toBeUndefined();
    expect(
      decorDuParcours(index, [
        [5.37, 43.29],
        [5.38, 43.3],
      ]),
    ).toBeUndefined();
  });
});
