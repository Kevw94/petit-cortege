/**
 * Placement des avatars du prototype dans le monde en pixels (tuile 16 px ≈ 2 m).
 *
 * Volontairement rapide (appelé 20 000 fois par image) : tracé projeté une fois,
 * longueurs cumulées précalculées, recherche dichotomique du tronçon, décalage
 * latéral mis en cache par identifiant. `pointSurParcours` (haversine à chaque
 * tronçon et à chaque appel) serait trop lent à cette échelle.
 *
 * Le décalage latéral est un substitut local au prototype ; le vrai décalage
 * déterministe appartient au Cortège (#5).
 */
import type { Parcours } from '@petit-cortege/shared';

export const PX_PAR_M = 16 / 2;

export interface OptionsPlacement {
  /** Largeur de rue sur laquelle les avatars s'étalent, en mètres. */
  largeurRueM: number;
}

export type Placer = (distanceM: number, id: string) => { x: number; y: number };

/** Hachage FNV-1a 32 bits ramené dans [0, 1). */
function hachage01(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Brassage final (murmur3 fmix32) : sans lui, des identifiants consécutifs donnent des valeurs groupées.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

export function creerPlacement(parcours: Parcours, { largeurRueM }: OptionsPlacement): Placer {
  const points = parcours.coordinates;
  const origine = points[0]!;
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180) * PX_PAR_M;
  const ky = 110_540 * PX_PAR_M;
  const xs = points.map((p) => (p[0] - origine[0]) * kx);
  const ys = points.map((p) => -(p[1] - origine[1]) * ky);
  // cumul[i] : distance (m) du départ au point i ; normales unitaires de chaque tronçon.
  const cumul = [0];
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = xs[i]! - xs[i - 1]!;
    const dy = ys[i]! - ys[i - 1]!;
    const l = Math.hypot(dx, dy) || 1;
    cumul.push(cumul[i - 1]! + l / PX_PAR_M);
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  const decalages = new Map<string, number>();

  return (distanceM, id) => {
    let decalage = decalages.get(id);
    if (decalage === undefined) {
      decalage = (hachage01(id) - 0.5) * largeurRueM * PX_PAR_M;
      decalages.set(id, decalage);
    }
    const d = Math.min(Math.max(distanceM, 0), cumul[cumul.length - 1]!);
    // Dernier point i tel que cumul[i] <= d.
    let bas = 0;
    let haut = cumul.length - 1;
    while (haut - bas > 1) {
      const milieu = (bas + haut) >> 1;
      if (cumul[milieu]! <= d) bas = milieu;
      else haut = milieu;
    }
    const f = (d - cumul[bas]!) / (cumul[haut]! - cumul[bas]! || 1);
    return {
      x: xs[bas]! + (xs[haut]! - xs[bas]!) * f + nx[bas]! * decalage,
      y: ys[bas]! + (ys[haut]! - ys[bas]!) * f + ny[bas]! * decalage,
    };
  };
}
