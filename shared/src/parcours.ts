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
