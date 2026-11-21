/**
 * Noms des places traversées par le parcours (ADR 0006 : la place d'arrivée est
 * une place générique du tileset, avec son nom affiché ; pas de nom de rue).
 *
 * Une place : un objet OSM nommé `place=square`, ou une voie ou surface
 * (`highway`, `area:highway`) dont le nom est celui d'une place (« Place … »,
 * « Square … », « Esplanade … », « Parvis … », « Rond-point … », « Carrefour … »).
 * Les objets de même nom (une place est souvent faite de plusieurs voies) sont
 * réunis ; la place est traversée si le parcours passe à moins de `distanceMax`.
 */
import type { PlaceDecor, PointTuiles } from '@petit-cortege/shared';

export interface CandidatPlace {
  tags: Record<string, string>;
  /** Géométrie en tuiles : ligne (ou point d'un nœud) et anneaux. */
  ligne: PointTuiles[];
  anneaux: PointTuiles[][];
}

const NOM_DE_PLACE = /^(place|square|esplanade|parvis|rond-point|carrefour)\b/i;

export function estPlace(tags: Record<string, string>): boolean {
  const nom = tags.name;
  if (!nom) return false;
  if (tags.place === 'square') return true;
  return (
    NOM_DE_PLACE.test(nom) &&
    (tags.highway !== undefined || tags['area:highway'] !== undefined || tags.place !== undefined)
  );
}

/**
 * Places traversées par le parcours (en tuiles), avec leur centre (milieu de
 * l'emprise de leurs objets) ; la plus proche du point d'arrivée est la place d'arrivée.
 */
export function placesTraversees(objets: CandidatPlace[], parcours: PointTuiles[], distanceMax: number): PlaceDecor[] {
  const groupes = new Map<string, CandidatPlace[]>();
  for (const o of objets) {
    if (!estPlace(o.tags)) continue;
    const nom = o.tags.name!;
    groupes.set(nom, [...(groupes.get(nom) ?? []), o]);
  }
  const arrivee = parcours[parcours.length - 1]!;
  const places = [...groupes].flatMap(([nom, groupe]) => {
    const distance = Math.min(...groupe.map((o) => distanceAuParcours(o, parcours)));
    if (distance > distanceMax) return [];
    const points = groupe.flatMap((o) => [...o.ligne, ...o.anneaux.flat()]);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const aLArrivee = Math.min(...groupe.map((o) => distanceAuParcours(o, [arrivee])));
    return [
      {
        nom,
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        arrivee: false,
        aLArrivee,
      },
    ];
  });
  const plusProche = places.reduce<(typeof places)[number] | undefined>(
    (p, q) => (!p || q.aLArrivee < p.aLArrivee ? q : p),
    undefined,
  );
  return places
    .map(({ aLArrivee, ...p }) => ({ ...p, arrivee: p.nom === plusProche?.nom && aLArrivee <= distanceMax }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/** Distance entre un objet (surface, ligne ou point) et une polyligne (0 si elle la traverse ou y entre). */
function distanceAuParcours(o: CandidatPlace, parcours: PointTuiles[]): number {
  if (o.anneaux.length > 0 && parcours.some((p) => dedans(o.anneaux, p))) return 0;
  const segmentsObjet = [...segments(o.ligne), ...o.anneaux.flatMap(segments)];
  const segmentsParcours = segments(parcours);
  let d = Infinity;
  for (const [a, b] of segmentsObjet)
    for (const [c, e] of segmentsParcours) d = Math.min(d, distanceSegments(a, b, c, e));
  return d;
}

/** Segments d'une polyligne ; un point seul donne un segment nul. */
const segments = (l: PointTuiles[]): [PointTuiles, PointTuiles][] =>
  l.length === 1 ? [[l[0]!, l[0]!]] : l.slice(1).map((b, i) => [l[i]!, b]);

function dedans(anneaux: PointTuiles[][], p: PointTuiles): boolean {
  let n = 0;
  for (const anneau of anneaux) {
    for (let i = 1; i < anneau.length; i++) {
      const [a, b] = [anneau[i - 1]!, anneau[i]!];
      if (a.y <= p.y !== b.y <= p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) n++;
    }
  }
  return n % 2 === 1;
}

function distancePointSegment(p: PointTuiles, a: PointTuiles, b: PointTuiles): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const orientation = (a: PointTuiles, b: PointTuiles, c: PointTuiles) =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

function distanceSegments(a: PointTuiles, b: PointTuiles, c: PointTuiles, d: PointTuiles): number {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    distancePointSegment(a, c, d),
    distancePointSegment(b, c, d),
    distancePointSegment(c, a, b),
    distancePointSegment(d, a, b),
  );
}
