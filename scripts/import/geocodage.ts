/**
 * Géocodage des étapes annoncées : API de géocodage de la Géoplateforme IGN
 * (Base Adresse Nationale, Licence Ouverte 2.0), repli sur l'API Adresse
 * historique (api-adresse.data.gouv.fr, même format de réponse).
 *
 * Un résultat n'est retenu que s'il est dans la ville de la manif et que son
 * score est suffisant ; sinon le message dit quelle étape corriger.
 */
import { distanceM, type Position } from '@petit-cortege/shared';
import { ErreurImport } from './fichier';
import { ErreurService, requeteJson, type Reseau } from './reseau';

export const URL_GEOCODAGE_IGN = 'https://data.geopf.fr/geocodage/search';
export const URL_GEOCODAGE_BAN = 'https://api-adresse.data.gouv.fr/search/';
/** Score minimal accepté (0 à 1) : en dessous, l'adresse est trop douteuse pour tracer un cortège. */
export const SCORE_MIN = 0.7;
/**
 * Un même lieu découpé entre arrondissements (place de la Bastille : 4e, 11e, 12e)
 * revient en plusieurs résultats de même nom : on prend leur barycentre, au
 * centre de la place, plutôt qu'un bord pris au hasard.
 */
const ECART_SCORE_FUSION = 0.02;
const DISTANCE_FUSION_M = 400;

export interface ServiceGeocodage {
  nom: string;
  url: string;
}

export const SERVICES_GEOCODAGE: ServiceGeocodage[] = [
  { nom: 'Géoplateforme IGN (géocodage)', url: URL_GEOCODAGE_IGN },
  { nom: 'API Adresse (BAN)', url: URL_GEOCODAGE_BAN },
];

interface ReponseGeocodage {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: { label: string; score: number; name?: string; city?: string; citycode?: string; type?: string };
  }[];
}

export interface LieuGeocode {
  position: Position;
  /** Libellé de la Base Adresse Nationale (ex. « Place Carnot 54000 Nancy »). */
  libelle: string;
  /** Nom de la voie ou du lieu (ex. « Place Carnot »). */
  nom: string;
  score: number;
  /** Type BAN : street, housenumber, locality, municipality… */
  type: string;
  citycode: string;
  service: string;
  /** Nombre de résultats fusionnés (lieu découpé entre arrondissements). */
  fusionnes: number;
}

/** « Charleville-Mézières » → « charleville mezieres » (comparaison de noms). */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ville BAN égale à la ville de la manif (Paris : « Paris », quel que soit l'arrondissement). */
const memeVille = (a: string | undefined, b: string) => a !== undefined && normaliser(a) === normaliser(b);

/**
 * Géocode `requete` dans `ville` ; `quoi` désigne l'étape dans les messages.
 * Essaie les services dans l'ordre : un service en panne passe la main au suivant ;
 * un résultat douteux est une erreur (pas de repli : l'étape est à corriger).
 */
export async function geocoder(
  reseau: Reseau,
  requete: string,
  ville: string,
  quoi: string,
  services: ServiceGeocodage[] = SERVICES_GEOCODAGE,
): Promise<LieuGeocode> {
  const pannes: string[] = [];
  for (const service of services) {
    const url = new URL(service.url);
    url.searchParams.set('q', requete);
    url.searchParams.set('limit', '10');
    let reponse: ReponseGeocodage;
    try {
      reponse = await requeteJson<ReponseGeocodage>(reseau, url.toString());
    } catch (e) {
      if (!(e instanceof ErreurService)) throw e;
      pannes.push(e.message);
      continue;
    }
    return choisir(reponse, requete, ville, quoi, service.nom);
  }
  throw new ErreurImport(`${quoi} : géocodage impossible, services indisponibles (${pannes.join(' ; ')}).`);
}

function choisir(
  reponse: ReponseGeocodage,
  requete: string,
  ville: string,
  quoi: string,
  service: string,
): LieuGeocode {
  const resultats = [...(reponse.features ?? [])].sort((a, b) => b.properties.score - a.properties.score);
  const premier = resultats[0];
  if (!premier)
    throw new ErreurImport(
      `${quoi} : « ${requete} » introuvable (${service}). Corriger l'adresse ou donner une « position ».`,
    );
  const dansLaVille = resultats.filter((r) => memeVille(r.properties.city, ville));
  const meilleur = dansLaVille[0];
  if (!meilleur) {
    throw new ErreurImport(
      `${quoi} : « ${requete} » donne « ${premier.properties.label} », hors de ${ville}. ` +
        `Préciser l'adresse (ajouter « , ${ville} ») ou donner une « position ».`,
    );
  }
  const p = meilleur.properties;
  if (p.score < SCORE_MIN) {
    throw new ErreurImport(
      `${quoi} : « ${requete} » donne au mieux « ${p.label} » avec un score de ${p.score.toFixed(2)} ` +
        `(minimum ${SCORE_MIN}). Corriger l'adresse ou donner une « position ».`,
    );
  }
  if (p.type === 'municipality') {
    throw new ErreurImport(`${quoi} : « ${requete} » ne désigne que la commune (« ${p.label} »). Préciser le lieu.`);
  }
  const nom = normaliser(p.name ?? p.label);
  const fusion = dansLaVille.filter(
    (r) =>
      normaliser(r.properties.name ?? r.properties.label) === nom &&
      r.properties.score >= p.score - ECART_SCORE_FUSION &&
      distanceM(r.geometry.coordinates, meilleur.geometry.coordinates) <= DISTANCE_FUSION_M,
  );
  const moyenne = (i: 0 | 1) => fusion.reduce((s, r) => s + r.geometry.coordinates[i], 0) / fusion.length;
  return {
    position: [arrondir(moyenne(0)), arrondir(moyenne(1))],
    libelle: fusion.length > 1 ? `${p.name ?? p.label}, ${p.city} (centre de ${fusion.length} résultats BAN)` : p.label,
    nom: p.name ?? p.label,
    score: Math.round(p.score * 1000) / 1000,
    type: p.type ?? '',
    citycode: p.citycode ?? '',
    service,
    fusionnes: fusion.length,
  };
}

export const arrondir = (x: number) => Math.round(x * 1e6) / 1e6;
