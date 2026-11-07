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
    throw new ErreurModeration(`GeoJSON : coordonnées invalides au point n° ${rang + 1} (attendu [longitude, latitude]).`);
  }
  return [lon, lat]; // l'altitude éventuelle est ignorée
}

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
    throw new ErreurModeration(`GeoJSON : plusieurs LineString (${trouvees.length}) ; garder un seul tracé, du départ à l'arrivée.`);
  }
  const coordonnees = trouvees[0];
  if (!Array.isArray(coordonnees) || coordonnees.length < 2) {
    throw new ErreurModeration('GeoJSON : le parcours doit compter au moins 2 points.');
  }
  return { type: 'LineString', coordinates: coordonnees.map(lirePosition) };
}
