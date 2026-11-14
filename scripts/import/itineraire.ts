/**
 * Itinéraire piéton passant par toutes les étapes : API d'itinéraire de la
 * Géoplateforme IGN (graphe BD TOPO, moteur OSRM, Licence Ouverte 2.0), repli
 * sur l'OSRM piéton de FOSSGIS (routing.openstreetmap.de, données OSM, ODbL).
 */
import type { Position } from '@petit-cortege/shared';
import { ErreurImport } from './fichier';
import { ErreurService, requeteJson, type Reseau } from './reseau';

export const URL_ITINERAIRE_IGN = 'https://data.geopf.fr/navigation/itineraire';
export const URL_OSRM_PIETON = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export interface Itineraire {
  coordonnees: Position[];
  /** Distance annoncée par le service, en mètres. */
  distanceM: number;
  /** Rues empruntées dans l'ordre (consécutives fusionnées), avec leur longueur. */
  rues: { nom: string; m: number }[];
  service: string;
  /** Mention à reproduire (licence des données du graphe). */
  attribution: string;
  /** Version des données du graphe, si le service la donne. */
  versionDonnees?: string;
}

export interface ServiceItineraire {
  nom: string;
  calculer: (reseau: Reseau, points: Position[]) => Promise<Itineraire>;
}

const enTexte = (p: Position) => `${p[0]},${p[1]}`;

function fusionnerRues(rues: { nom: string; m: number }[]): { nom: string; m: number }[] {
  const resultat: { nom: string; m: number }[] = [];
  for (const { nom, m } of rues) {
    const dernier = resultat.at(-1);
    if (dernier && dernier.nom === nom) dernier.m += m;
    else resultat.push({ nom, m });
  }
  return resultat.map((r) => ({ nom: r.nom || '(sans nom)', m: Math.round(r.m) }));
}

interface ReponseIgn {
  resourceVersion?: string;
  distance: number;
  geometry?: { type: string; coordinates: Position[] };
  portions?: { steps?: { distance: number; attributes?: { name?: unknown } }[] }[];
}

/** Nom d'une voie dans la réponse IGN : texte, ou objet `{ name: … }` selon les versions. */
function nomVoie(nom: unknown): string {
  if (typeof nom === 'string') return nom;
  if (typeof nom !== 'object' || nom === null) return '';
  const champs = nom as Record<string, unknown>;
  const valeur = champs.name ?? champs.nom_1_gauche ?? champs.nom_1_droite;
  return typeof valeur === 'string' ? valeur : '';
}

export const ITINERAIRE_IGN: ServiceItineraire = {
  nom: 'Géoplateforme IGN (itinéraire piéton, bdtopo-osrm)',
  calculer: async (reseau, points) => {
    const url = new URL(URL_ITINERAIRE_IGN);
    url.searchParams.set('resource', 'bdtopo-osrm');
    url.searchParams.set('profile', 'pedestrian');
    url.searchParams.set('optimization', 'shortest');
    url.searchParams.set('start', enTexte(points[0]!));
    url.searchParams.set('end', enTexte(points.at(-1)!));
    if (points.length > 2) url.searchParams.set('intermediates', points.slice(1, -1).map(enTexte).join('|'));
    url.searchParams.set('geometryFormat', 'geojson');
    // Les étapes de navigation donnent les noms des voies empruntées (à relire par le porteur).
    url.searchParams.set('getSteps', 'true');
    const reponse = await requeteJson<ReponseIgn>(reseau, url.toString());
    const coordonnees = reponse.geometry?.coordinates;
    if (reponse.geometry?.type !== 'LineString' || !Array.isArray(coordonnees) || coordonnees.length < 2) {
      throw new ErreurService('data.geopf.fr : itinéraire sans géométrie LineString');
    }
    return {
      coordonnees,
      distanceM: reponse.distance,
      rues: fusionnerRues(
        (reponse.portions ?? []).flatMap((p) => (p.steps ?? []).map((s) => ({ nom: nomVoie(s.attributes?.name), m: s.distance }))),
      ),
      service: ITINERAIRE_IGN.nom,
      attribution: 'IGN – Géoplateforme, BD TOPO® (Licence Ouverte 2.0)',
      ...(reponse.resourceVersion ? { versionDonnees: reponse.resourceVersion } : {}),
    };
  },
};

interface ReponseOsrm {
  code: string;
  message?: string;
  routes?: { distance: number; geometry: { coordinates: Position[] }; legs: { steps?: { name: string; distance: number }[] }[] }[];
}

export const ITINERAIRE_OSRM: ServiceItineraire = {
  nom: 'OSRM FOSSGIS (routing.openstreetmap.de, piéton)',
  calculer: async (reseau, points) => {
    const url = `${URL_OSRM_PIETON}/${points.map(enTexte).join(';')}?overview=full&geometries=geojson&steps=true`;
    const reponse = await requeteJson<ReponseOsrm>(reseau, url);
    const route = reponse.routes?.[0];
    if (reponse.code !== 'Ok' || !route) throw new ErreurService(`routing.openstreetmap.de : ${reponse.code} ${reponse.message ?? ''}`);
    return {
      coordonnees: route.geometry.coordinates,
      distanceM: route.distance,
      rues: fusionnerRues(route.legs.flatMap((l) => (l.steps ?? []).map((s) => ({ nom: s.name, m: s.distance })))),
      service: ITINERAIRE_OSRM.nom,
      attribution: '© les contributeurs d’OpenStreetMap (ODbL), OSRM / FOSSGIS',
    };
  },
};

export const SERVICES_ITINERAIRE = [ITINERAIRE_IGN, ITINERAIRE_OSRM];

/** Calcule l'itinéraire avec le premier service qui répond ; signale chaque repli. */
export async function calculerItineraire(
  reseau: Reseau,
  points: Position[],
  quoi: string,
  journal: (ligne: string) => void,
  services: ServiceItineraire[] = SERVICES_ITINERAIRE,
): Promise<Itineraire> {
  const pannes: string[] = [];
  for (const service of services) {
    try {
      return await service.calculer(reseau, points);
    } catch (e) {
      if (!(e instanceof ErreurService)) throw e;
      pannes.push(e.message);
      journal(`  ${service.nom} indisponible (${e.message}), repli…`);
    }
  }
  throw new ErreurImport(`${quoi} : aucun service d'itinéraire n'a répondu (${pannes.join(' ; ')}).`);
}
