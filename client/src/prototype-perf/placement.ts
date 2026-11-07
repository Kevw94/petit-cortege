/**
 * Placement des avatars du Cortège dans le monde en pixels (tuile 16 px ≈ 2 m).
 *
 * Même résultat que `positionDansLeCortege` (shared/src/parcours.ts) suivi d'une
 * projection, mais conçu pour être appelé 20 000 fois par image : tracé projeté
 * une fois, longueurs cumulées précalculées, recherche dichotomique du tronçon.
 * `positionDansLeCortege` refait l'haversine de chaque tronçon à chaque appel :
 * à mesurer avant de l'utiliser à cette échelle dans la vraie scène (#10, #14).
 */
import type { Parcours } from '@petit-cortege/shared';

export const PX_PAR_M = 16 / 2;

/** Distance le long du parcours et décalage latéral (positif à gauche), en mètres → pixels monde (y vers le bas). */
export type Placer = (distanceM: number, decalageM: number) => { x: number; y: number };

export function creerPlacement(parcours: Parcours): Placer {
  const points = parcours.coordinates;
  const origine = points[0]!;
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180) * PX_PAR_M;
  const ky = 110_540 * PX_PAR_M;
  const xs = points.map((p) => (p[0] - origine[0]) * kx);
  const ys = points.map((p) => -(p[1] - origine[1]) * ky);
  // cumul[i] : distance (m) du départ au point i ; (gx, gy) : vecteur unitaire vers la gauche de chaque tronçon.
  const cumul = [0];
  const gx: number[] = [];
  const gy: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = xs[i]! - xs[i - 1]!;
    const dy = ys[i]! - ys[i - 1]!;
    const l = Math.hypot(dx, dy) || 1;
    cumul.push(cumul[i - 1]! + l / PX_PAR_M);
    gx.push(dy / l);
    gy.push(-dx / l);
  }
  const fin = cumul[cumul.length - 1]!;

  return (distanceM, decalageM) => {
    // Pas de plancher : une distance négative prolonge le premier tronçon (rangées en attente).
    const d = Math.min(distanceM, fin);
    let bas = 0;
    let haut = cumul.length - 1;
    while (haut - bas > 1) {
      const milieu = (bas + haut) >> 1;
      if (cumul[milieu]! <= d) bas = milieu;
      else haut = milieu;
    }
    const f = (d - cumul[bas]!) / (cumul[haut]! - cumul[bas]! || 1);
    const decalage = decalageM * PX_PAR_M;
    return {
      x: xs[bas]! + (xs[haut]! - xs[bas]!) * f + gx[bas]! * decalage,
      y: ys[bas]! + (ys[haut]! - ys[bas]!) * f + gy[bas]! * decalage,
    };
  };
}
