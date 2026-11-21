import type { Parcours, Position } from '@petit-cortege/shared';
import { ErreurModeration } from './moderation';

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Géométries LineString trouvées dans un objet GeoJSON (les autres géométries, ex. marqueurs, sont ignorées). */
function lignes(geojson: unknown): unknown[] {
  if (!estObjet(geojson)) return [];
  switch (geojson.type) {
    case 'LineString':
      return [geojson.coordinates];
    case 'Feature':
      return lignes(geojson.geometry);
    case 'FeatureCollection':
      return Array.isArray(geojson.features) ? geojson.features.flatMap(lignes) : [];
    case 'GeometryCollection':
      return Array.isArray(geojson.geometries) ? geojson.geometries.flatMap(lignes) : [];
    default:
      return [];
  }
}

function lirePosition(p: unknown, rang: number): Position {
  const [lon, lat] = Array.isArray(p) ? p : [];
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  ) {
    throw new ErreurModeration(
      `GeoJSON : coordonnées invalides au point n° ${rang + 1} (attendu [longitude, latitude]).`,
    );
  }
  // L'altitude éventuelle est ignorée ; 6 décimales ≈ 10 cm, bien assez pour un cortège,
  // et deux fois moins d'octets dans la liste des manifs que la pleine précision d'uMap (#19).
  return [arrondir(lon), arrondir(lat)];
}

const arrondir = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Lit le parcours d'un GeoJSON exporté par uMap : une LineString seule, une
 * Feature, ou une FeatureCollection qui contient exactement une LineString
 * (les marqueurs éventuels sont ignorés). Le tracé va du départ vers l'arrivée.
 */
export function lireParcoursGeoJson(geojson: unknown): Parcours {
  const trouvees = lignes(geojson);
  if (trouvees.length === 0) {
    throw new ErreurModeration('GeoJSON : aucune LineString (le parcours doit être tracé comme une ligne dans uMap).');
  }
  if (trouvees.length > 1) {
    throw new ErreurModeration(
      `GeoJSON : plusieurs LineString (${trouvees.length}) ; garder un seul tracé, du départ à l'arrivée.`,
    );
  }
  const coordonnees = trouvees[0];
  if (!Array.isArray(coordonnees) || coordonnees.length < 2) {
    throw new ErreurModeration('GeoJSON : le parcours doit compter au moins 2 points.');
  }
  return { type: 'LineString', coordinates: coordonnees.map(lirePosition) };
}

/**
 * Noms des étapes annoncées, s'ils sont dans les propriétés du GeoJSON
 * (tracé calculé, ADR 0009). Un export uMap n'en a pas : liste vide.
 * `demande` est le lieu tel qu'annoncé ; `libelle` est le repli (réponse du géocodeur).
 */
export function lireEtapesAnnoncees(geojson: unknown): string[] {
  const proprietes = proprietesEtapes(geojson);
  if (!proprietes || !Array.isArray(proprietes.etapes)) return [];
  const noms: string[] = [];
  for (const etape of proprietes.etapes) {
    if (!estObjet(etape)) continue;
    const demande = typeof etape.demande === 'string' ? etape.demande.trim() : '';
    const libelle = typeof etape.libelle === 'string' ? etape.libelle.trim() : '';
    const nom = demande || libelle;
    if (nom) noms.push(nom);
  }
  return noms;
}

function proprietesEtapes(geojson: unknown): Objet | undefined {
  if (!estObjet(geojson)) return;
  if (geojson.type === 'Feature' && estObjet(geojson.properties)) return geojson.properties;
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    for (const feature of geojson.features) {
      if (estObjet(feature) && estObjet(feature.properties) && Array.isArray(feature.properties.etapes)) {
        return feature.properties;
      }
    }
  }
  return;
}
