/**
 * Itinéraire le long des chemins OSM de rues nommées (la rue suivie, et les
 * places qu'elle traverse) : plus court chemin
 * (Dijkstra) entre les nœuds les plus proches du départ et de l'arrivée, sur
 * les seules chaussées de ces rues (pistes cyclables et trottoirs exclus).
 */
import { distanceM, type Parcours, type Position } from '@petit-cortege/shared';
import type { ExtraitOverpass } from './osm';

const NON_CHAUSSEES = ['cycleway', 'footway', 'path', 'steps', 'pedestrian', 'construction', 'proposed'];

export function itineraireLeLongDe(
  extrait: ExtraitOverpass,
  options: { rues: string[]; depart: Position; arrivee: Position },
): Parcours {
  const positions = new Map<number, Position>();
  const voisins = new Map<number, { vers: number; m: number }[]>();
  const relier = (a: number, b: number, m: number) => {
    voisins.set(a, [...(voisins.get(a) ?? []), { vers: b, m }]);
    voisins.set(b, [...(voisins.get(b) ?? []), { vers: a, m }]);
  };
  for (const e of extrait.elements) {
    const t = e.tags ?? {};
    if (e.type !== 'way' || !options.rues.includes(t.name ?? '') || !t.highway || NON_CHAUSSEES.includes(t.highway)) continue;
    const noeuds = e.nodes ?? [];
    const geometrie = e.geometry ?? [];
    noeuds.forEach((id, i) => {
      const p = geometrie[i];
      if (p) positions.set(id, [p.lon, p.lat]);
    });
    for (let i = 1; i < noeuds.length; i++) {
      const [a, b] = [noeuds[i - 1]!, noeuds[i]!];
      if (positions.has(a) && positions.has(b)) relier(a, b, distanceM(positions.get(a)!, positions.get(b)!));
    }
  }
  const noms = options.rues.map((r) => `« ${r} »`).join(', ');
  if (positions.size === 0) throw new Error(`Aucun chemin ${noms} dans l'extrait.`);

  const plusProche = (p: Position) =>
    [...positions].reduce((meilleur, courant) => (distanceM(courant[1], p) < distanceM(meilleur[1], p) ? courant : meilleur))[0];
  const depart = plusProche(options.depart);
  const arrivee = plusProche(options.arrivee);

  // Dijkstra (graphe de quelques centaines de nœuds : file sans tas).
  const distances = new Map<number, number>([[depart, 0]]);
  const precedent = new Map<number, number>();
  const aVisiter = new Set<number>([depart]);
  while (aVisiter.size > 0) {
    const courant = [...aVisiter].reduce((a, b) => (distances.get(a)! <= distances.get(b)! ? a : b));
    aVisiter.delete(courant);
    if (courant === arrivee) break;
    for (const { vers, m } of voisins.get(courant) ?? []) {
      const d = distances.get(courant)! + m;
      if (d < (distances.get(vers) ?? Infinity)) {
        distances.set(vers, d);
        precedent.set(vers, courant);
        aVisiter.add(vers);
      }
    }
  }
  if (!distances.has(arrivee)) throw new Error(`L'itinéraire par ${noms} ne relie pas le départ à l'arrivée.`);

  const chemin = [arrivee];
  while (chemin[0] !== depart) chemin.unshift(precedent.get(chemin[0]!)!);
  return { type: 'LineString', coordinates: chemin.map((id) => positions.get(id)!) };
}
