/**
 * Repère de la vue 3D. Le décor et les avatars sont en mètres depuis l'origine du décor
 * (x vers l'est, y vers le sud : la projection de la tilemap, shared/src/decor.ts). Dans la
 * scène Three.js, le sol est le plan horizontal : x reste l'est, z est le sud, y la hauteur
 * (repère direct, rien n'est retourné).
 *
 * Le placement le long du parcours reproduit `positionDansLeCortege` (mêmes longueurs de
 * tronçons, même décalage à gauche du sens de marche) avec des longueurs cumulées
 * précalculées : pas de haversine à chaque avatar et à chaque image (recommandation #4).
 */
import { distanceM, type Parcours, type Position } from '@petit-cortege/shared';
import type { PointM } from '../cadrage';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Point au sol (mètres) → coordonnées de la scène, à `hauteur` mètres au-dessus du sol. */
export function versScene(p: PointM, hauteur = 0): Point3 {
  return { x: p.x, y: hauteur, z: p.y };
}

/** Coordonnées de la scène → point au sol (mètres), hauteur ignorée. */
export function versMetres(p: Point3): PointM {
  return { x: p.x, y: p.z };
}

export interface Placeur {
  /** Point du cortège à `distance` mètres du départ, décalé à gauche du sens de marche. */
  placer(distance: number, decalage: number): PointM;
  /** Direction de marche à `distance` (radians, depuis l'est, positif vers le sud). */
  cap(distance: number): number;
  longueurM: number;
}

export function creerPlaceur(parcours: Parcours, projeter: (p: Position) => PointM): Placeur {
  const positions = parcours.coordinates;
  const points = positions.map(projeter);
  // cumul[i] : longueur (m) du départ au point i, comme `positionDansLeCortege`.
  const cumul = [0];
  for (let i = 1; i < positions.length; i++) cumul.push(cumul[i - 1]! + distanceM(positions[i - 1]!, positions[i]!));
  const n = points.length;
  const longueurM = cumul[n - 1] ?? 0;

  /** Tronçon i (de i-1 à i) qui porte la distance, et ce qui reste à parcourir dessus. */
  const troncon = (distance: number) => {
    // Premier i (≤ n-2) tel que distance ≤ cumul[i], sinon le dernier tronçon.
    let bas = 1;
    let haut = n - 1;
    while (bas < haut) {
      const milieu = (bas + haut) >> 1;
      if (distance <= cumul[milieu]!) haut = milieu;
      else bas = milieu + 1;
    }
    return { i: bas, restant: distance - cumul[bas - 1]! };
  };

  const direction = (i: number) => {
    const a = points[i - 1]!;
    const b = points[i]!;
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    return longueur === 0 ? null : { x: (b.x - a.x) / longueur, y: (b.y - a.y) / longueur };
  };

  return {
    longueurM,
    placer(distance, decalage) {
      if (n < 2) return { ...points[0]! };
      const { i, restant } = troncon(distance);
      const a = points[i - 1]!;
      const b = points[i]!;
      const longueur = cumul[i]! - cumul[i - 1]!;
      const u = direction(i);
      if (!u || longueur === 0) return { ...a };
      // Au-delà du point d'arrivée, dans le prolongement du dernier tronçon (la place d'arrivée).
      const f = (i === n - 1 ? restant : Math.min(restant, longueur)) / longueur;
      // À gauche du sens de marche (y vers le sud) : (u.y, -u.x).
      return { x: a.x + (b.x - a.x) * f + u.y * decalage, y: a.y + (b.y - a.y) * f - u.x * decalage };
    },
    cap(distance) {
      if (n < 2) return 0;
      const { i } = troncon(distance);
      // Tronçons de longueur nulle : on prend le précédent ou le suivant.
      let u = direction(i);
      for (let j = i; !u && j > 1; ) u = direction(--j);
      for (let j = i; !u && j < n - 1; ) u = direction(++j);
      return u ? Math.atan2(u.y, u.x) : 0;
    },
  };
}
