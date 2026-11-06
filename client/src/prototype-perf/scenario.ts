/**
 * Scénario synthétique du prototype de performance (ticket #4) : une manif
 * fictive et n entrées régulières, au format publié, à donner au Cortège.
 * Rien n'est chargé du réseau : le prototype mesure le rendu, pas la publication.
 */
import {
  calculerFin,
  longueurParcours,
  type EntreePubliee,
  type EntreesMinute,
  type ManifPubliee,
  type Position,
} from '@petit-cortege/shared';

/** Durée des entrées, toutes après le départ : à 2 km/h, la tête du cortège est à 4 km. */
const DUREE_ENTREES_S = 2 * 3600;
const DEPART = Date.parse('2026-05-01T14:00:00Z');
/** Tracé ≈ 6,5 km autour de Paris, en mètres (est, nord) depuis l'origine. */
const TRACE_M: Array<[number, number]> = [
  [0, 0],
  [1500, 0],
  [2500, 800],
  [4000, 800],
  [5000, 0],
  [6000, 0],
];
const ORIGINE: Position = [2.35, 48.86];

export interface ScenarioPerf {
  manif: ManifPubliee;
  entrees: EntreesMinute[];
  /** Heure à laquelle le cortège est étalé sur toute la durée des entrées. */
  maintenant: Date;
}

function versPosition([est, nord]: [number, number]): Position {
  const kx = 111_320 * Math.cos((ORIGINE[1] * Math.PI) / 180);
  return [ORIGINE[0] + est / kx, ORIGINE[1] + nord / 110_540];
}

export function scenarioPerf(n: number): ScenarioPerf {
  const parcours = { type: 'LineString' as const, coordinates: TRACE_M.map(versPosition) };
  const longueurM = longueurParcours(parcours);
  const depart = new Date(DEPART);
  const manif: ManifPubliee = {
    id: 'proto-perf',
    intitule: 'Prototype de performance',
    ville: 'Paris',
    ouverture: new Date(DEPART - 3600_000).toISOString(),
    depart: depart.toISOString(),
    fin: calculerFin(depart, longueurM).toISOString(),
    parcours,
    longueurM,
    sources: [],
    compteur: n,
  };

  // Générateur congruentiel : apparences et pancartes variées mais reproductibles.
  let graine = 42;
  const hasard = () => (graine = (graine * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32;
  const parMinute = new Map<number, EntreePubliee[]>();
  for (let i = 0; i < n; i++) {
    const t = DEPART / 1000 + ((i + 0.5) / n) * DUREE_ENTREES_S;
    const minute = Math.floor(t / 60) * 60;
    const entree: EntreePubliee = { a: `av-${i}`, m: manif.id, t, ap: Math.floor(hasard() * 64), pa: Math.floor(hasard() * 16) };
    const liste = parMinute.get(minute);
    if (liste) liste.push(entree);
    else parMinute.set(minute, [entree]);
  }
  const entrees: EntreesMinute[] = [...parMinute].map(([minute, liste]) => ({
    v: 1,
    minute: new Date(minute * 1000).toISOString(),
    entrees: liste,
  }));
  return { manif, entrees, maintenant: new Date(DEPART + DUREE_ENTREES_S * 1000) };
}
