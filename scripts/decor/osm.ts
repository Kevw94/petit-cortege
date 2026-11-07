/**
 * Lecture d'un extrait OSM au format JSON d'Overpass (`out geom`) : chemins
 * avec leur géométrie, multipolygones dont on recolle les anneaux.
 */
import type { Position } from '@petit-cortege/shared';

interface PointOverpass {
  lat: number;
  lon: number;
}
interface MembreOverpass {
  type: string;
  ref: number;
  role: string;
  geometry?: (PointOverpass | null)[];
}
export interface ElementOverpass {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: (PointOverpass | null)[];
  members?: MembreOverpass[];
}
export interface ExtraitOverpass {
  elements: ElementOverpass[];
}

/** Objet OSM utile au décor : une ligne (chemin) et/ou des anneaux fermés (surface). */
export interface ObjetOsm {
  id: string;
  tags: Record<string, string>;
  /** Géométrie du chemin (vide pour une relation). */
  ligne: Position[];
  /** Anneaux fermés (chemin fermé, ou extérieurs et intérieurs d'un multipolygone), remplis pair-impair. */
  anneaux: Position[][];
}

const enPositions = (geometrie: (PointOverpass | null)[] | undefined): Position[] =>
  (geometrie ?? []).filter((p): p is PointOverpass => p !== null).map((p) => [p.lon, p.lat]);

const memePoint = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const estFerme = (l: Position[]) => l.length >= 4 && memePoint(l[0]!, l[l.length - 1]!);

/** Recolle bout à bout des morceaux de chemins en anneaux fermés (les morceaux restés ouverts sont ignorés). */
export function recollerAnneaux(morceaux: Position[][]): Position[][] {
  const restants = morceaux.filter((m) => m.length >= 2).map((m) => [...m]);
  const anneaux: Position[][] = [];
  while (restants.length > 0) {
    const anneau = restants.shift()!;
    let prolonge = true;
    while (!estFerme(anneau) && prolonge) {
      prolonge = false;
      const fin = anneau[anneau.length - 1]!;
      for (let i = 0; i < restants.length; i++) {
        const m = restants[i]!;
        if (memePoint(m[0]!, fin)) anneau.push(...m.slice(1));
        else if (memePoint(m[m.length - 1]!, fin)) anneau.push(...m.slice(0, -1).reverse());
        else continue;
        restants.splice(i, 1);
        prolonge = true;
        break;
      }
    }
    if (estFerme(anneau)) anneaux.push(anneau);
  }
  return anneaux;
}

/** Objets OSM d'un extrait Overpass (les nœuds isolés, ex. commerces, sont ignorés). */
export function lireExtrait(extrait: ExtraitOverpass): ObjetOsm[] {
  const objets: ObjetOsm[] = [];
  for (const e of extrait.elements) {
    const tags = e.tags ?? {};
    if (e.type === 'way') {
      const ligne = enPositions(e.geometry);
      if (ligne.length < 2) continue;
      objets.push({ id: `way/${e.id}`, tags, ligne, anneaux: estFerme(ligne) ? [ligne] : [] });
    } else if (e.type === 'relation' && (tags.type === 'multipolygon' || tags.type === 'boundary')) {
      const morceaux = (e.members ?? []).filter((m) => m.type === 'way').map((m) => enPositions(m.geometry));
      objets.push({ id: `relation/${e.id}`, tags, ligne: [], anneaux: recollerAnneaux(morceaux) });
    }
  }
  return objets;
}
