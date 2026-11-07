import { describe, expect, it } from 'vitest';
import { tracerParcours, versPosition, versTuiles, type Georeference } from './decor';

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
    const trace = tracerParcours([{ x: 10, y: 5 }, { x: 110, y: 5 }], { espacementFleches: 25 });
    expect(trace.ligne).toEqual([{ x: 10, y: 5 }, { x: 110, y: 5 }]);
    expect(trace.depart).toEqual({ x: 10, y: 5, angle: 0 });
    expect(trace.arrivee).toEqual({ x: 110, y: 5, angle: 0 });
  });

  it('pose une flèche à intervalles réguliers, ni sur le départ ni sur l’arrivée', () => {
    const trace = tracerParcours([{ x: 0, y: 0 }, { x: 100, y: 0 }], { espacementFleches: 25 });
    expect(trace.fleches).toEqual([
      { x: 25, y: 0, angle: 0 },
      { x: 50, y: 0, angle: 0 },
      { x: 75, y: 0, angle: 0 },
    ]);
  });

  it('oriente les flèches selon le tronçon où elles tombent (angle en degrés, sens horaire, y vers le bas)', () => {
    // 30 tuiles vers l'est puis 30 vers le sud.
    const trace = tracerParcours([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }], { espacementFleches: 20 });
    expect(trace.fleches).toEqual([
      { x: 20, y: 0, angle: 0 },
      { x: 30, y: 10, angle: 90 },
    ]);
    expect(trace.arrivee.angle).toBe(90);
  });
});
