/**
 * Briques pures de la liste des manifs (page d'accueil) : l'état d'une manif en mots, et la
 * miniature de son parcours (tracé SVG, nord en haut, proportions gardées).
 */
import { versTuiles, type Parcours } from '@petit-cortege/shared';

export type PhaseManif = 'avant' | 'en-marche' | 'terminee';

const duree = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const reste = minutes % 60;
  return `${Math.floor(minutes / 60)} h${reste ? ` ${String(reste).padStart(2, '0')}` : ''}`;
};

export function etatDeLaManif(manif: { depart: string; fin: string }, maintenant: Date): { texte: string; phase: PhaseManif } {
  const t = maintenant.getTime();
  const depart = Date.parse(manif.depart);
  if (t >= Date.parse(manif.fin)) return { texte: 'Terminée', phase: 'terminee' };
  // Avant le départ : arrondi à la minute supérieure (« dans 1 min » jusqu'au bout).
  if (t < depart) return { texte: `Départ dans ${duree(Math.ceil((depart - t) / 60_000) * 60_000)}`, phase: 'avant' };
  return { texte: `En marche depuis ${duree(t - depart)}`, phase: 'en-marche' };
}

export interface Miniature {
  points: { x: number; y: number }[];
  /** Chemin SVG (`M x y L x y …`). */
  d: string;
  /** Longueur du tracé, en pixels de la miniature. */
  longueur: number;
}

export function traceMiniature(parcours: Parcours, cadre: { largeur: number; hauteur: number; marge: number }): Miniature {
  // Projection locale du décor (y vers le sud), depuis le départ.
  const georef = { origine: parcours.coordinates[0]! };
  const projetes = parcours.coordinates.map((p) => versTuiles(georef, p));
  const xs = projetes.map((p) => p.x);
  const ys = projetes.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const utileL = cadre.largeur - 2 * cadre.marge;
  const utileH = cadre.hauteur - 2 * cadre.marge;
  const echelle = Math.min(x1 > x0 ? utileL / (x1 - x0) : Infinity, y1 > y0 ? utileH / (y1 - y0) : Infinity);
  const k = Number.isFinite(echelle) ? echelle : 0;
  const dx = (cadre.largeur - (x1 - x0) * k) / 2;
  const dy = (cadre.hauteur - (y1 - y0) * k) / 2;
  const points = projetes.map((p) => ({ x: dx + (p.x - x0) * k, y: dy + (p.y - y0) * k }));
  const n = (v: number) => String(Number(v.toFixed(1)));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join(' ');
  let longueur = 0;
  for (let i = 1; i < points.length; i++) longueur += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return { points, d, longueur };
}
