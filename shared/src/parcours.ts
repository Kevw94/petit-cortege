import type { Parcours, Position } from './format';

/** Rayon terrestre moyen (m). */
const RAYON_TERRE_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance orthodromique entre deux positions [lon, lat], en mètres. */
export function distanceM(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longueur du parcours, en mètres. */
export function longueurParcours(parcours: Parcours): number {
  let total = 0;
  const points = parcours.coordinates;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Position d'un avatar du cortège : point du parcours à `distance` mètres du
 * départ, décalé de `decalage` mètres perpendiculairement au tronçon (positif à
 * gauche du sens de marche). Une distance négative prolonge le premier tronçon
 * vers l'arrière (rangées qui attendent derrière la ligne de départ).
 */
export function positionDansLeCortege(parcours: Parcours, distance: number, decalage: number): Position {
  const points = parcours.coordinates;
  if (points.length < 2) return pointSurParcours(parcours, distance);
  let restant = distance;
  let i = 1;
  for (; i < points.length - 1; i++) {
    const troncon = distanceM(points[i - 1]!, points[i]!);
    if (restant <= troncon) break;
    restant -= troncon;
  }
  const a = points[i - 1]!;
  const b = points[i]!;
  // Mètres par degré autour du tronçon (projection locale, suffisante à l'échelle d'une rue).
  const kx = 111_320 * Math.cos(rad(a[1]));
  const ky = 110_540;
  const ex = (b[0] - a[0]) * kx;
  const ey = (b[1] - a[1]) * ky;
  const longueur = Math.hypot(ex, ey);
  const troncon = distanceM(a, b);
  if (longueur === 0 || troncon === 0) return a;
  const f = Math.min(restant, troncon) / troncon;
  const [ux, uy] = [ex / longueur, ey / longueur];
  return [a[0] + (b[0] - a[0]) * f + (-uy * decalage) / kx, a[1] + (b[1] - a[1]) * f + (ux * decalage) / ky];
}

/** Point du parcours situé à `distance` mètres du départ (plafonné aux extrémités). */
export function pointSurParcours(parcours: Parcours, distance: number): Position {
  const points = parcours.coordinates;
  if (points.length === 0) throw new Error('Parcours vide');
  let restant = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const troncon = distanceM(a, b);
    if (restant <= troncon && troncon > 0) {
      const f = restant / troncon;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    restant -= troncon;
  }
  return points[points.length - 1]!;
}
