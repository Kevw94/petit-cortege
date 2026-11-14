/** Géométrie en projection locale (mètres autour d'un point) pour la génération du décor. */
import type { Position } from '@petit-cortege/shared';

/** Douglas-Peucker en projection locale : garde les sommets qui s'écartent de plus de `toleranceM`. */
export function simplifierLigne(ligne: Position[], toleranceM: number): Position[] {
  if (ligne.length <= 2) return [...ligne];
  const origine = ligne[0]!;
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180);
  const ky = 110_540;
  const plan = ligne.map(([lon, lat]) => [(lon - origine[0]) * kx, (lat - origine[1]) * ky] as const);
  const garder = new Array<boolean>(ligne.length).fill(false);
  garder[0] = garder[ligne.length - 1] = true;
  const pile: [number, number][] = [[0, ligne.length - 1]];
  while (pile.length > 0) {
    const [i, j] = pile.pop()!;
    const [ax, ay] = plan[i]!;
    const [bx, by] = plan[j]!;
    const l = Math.hypot(bx - ax, by - ay);
    let [kMax, dMax] = [-1, 0];
    for (let k = i + 1; k < j; k++) {
      const [px, py] = plan[k]!;
      const d = l === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / l;
      if (d > dMax) [kMax, dMax] = [k, d];
    }
    if (kMax >= 0 && dMax > toleranceM) {
      garder[kMax] = true;
      pile.push([i, kMax], [kMax, j]);
    }
  }
  return ligne.filter((_, k) => garder[k]);
}
