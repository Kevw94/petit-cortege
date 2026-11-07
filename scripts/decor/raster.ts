/**
 * Grille de terrain en tuiles et rasterisation : une tuile prend une valeur
 * quand son centre tombe dans la forme peinte.
 */
import type { PointTuiles } from '@petit-cortege/shared';

export class Grille {
  readonly cases: Uint8Array;
  constructor(
    readonly largeur: number,
    readonly hauteur: number,
  ) {
    this.cases = new Uint8Array(largeur * hauteur);
  }

  lire(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.largeur || y >= this.hauteur) return 0;
    return this.cases[y * this.largeur + x]!;
  }

  /**
   * Peint `valeur` sur les tuiles dont le centre est à moins de `rayon` tuiles
   * de la polyligne. Si `masque` est vrai, seules les tuiles déjà non vides sont peintes.
   */
  peindreLigne(points: PointTuiles[], rayon: number, valeur: number, masque = true): void {
    for (let i = 1; i < points.length; i++) this.#peindreSegment(points[i - 1]!, points[i]!, rayon, valeur, masque);
    if (points.length === 1) this.#peindreSegment(points[0]!, points[0]!, rayon, valeur, masque);
  }

  #peindreSegment(a: PointTuiles, b: PointTuiles, rayon: number, valeur: number, masque: boolean): void {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - rayon));
    const x1 = Math.min(this.largeur - 1, Math.ceil(Math.max(a.x, b.x) + rayon));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - rayon));
    const y1 = Math.min(this.hauteur - 1, Math.ceil(Math.max(a.y, b.y) + rayon));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const r2 = rayon * rayon;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * this.largeur + x;
        if (masque && this.cases[i] === 0) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / l2));
        const ex = cx - (a.x + t * dx);
        const ey = cy - (a.y + t * dy);
        if (ex * ex + ey * ey <= r2) this.cases[i] = valeur;
      }
    }
  }

  /** Peint l'intérieur des anneaux (règle pair-impair : les anneaux intérieurs font des trous). */
  peindrePolygone(anneaux: PointTuiles[][], valeur: number): void {
    parcourirPolygone(anneaux, this.largeur, this.hauteur, (x, y) => {
      const i = y * this.largeur + x;
      if (this.cases[i] !== 0) this.cases[i] = valeur;
    });
  }
}

/**
 * Appelle `visiter` pour chaque tuile de la grille dont le centre est à
 * l'intérieur des anneaux (règle pair-impair : les anneaux intérieurs font des trous).
 */
export function parcourirPolygone(
  anneaux: PointTuiles[][],
  largeur: number,
  hauteur: number,
  visiter: (x: number, y: number) => void,
): void {
  const ys = anneaux.flat().map((p) => p.y);
  if (ys.length === 0) return;
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(hauteur - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (const anneau of anneaux) {
      for (let i = 1; i < anneau.length; i++) {
        const a = anneau[i - 1]!;
        const b = anneau[i]!;
        if (a.y <= cy !== b.y <= cy) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const debut = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const fin = Math.min(largeur - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
      for (let x = debut; x <= fin; x++) visiter(x, y);
    }
  }
}
