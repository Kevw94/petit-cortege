/**
 * Extraction OSM par l'API Overpass : la bande autour du parcours, en
 * `out geom` (chemins et multipolygones avec leur géométrie).
 *
 * Serveurs : `--overpass <url>` (répétable), essayés dans l'ordre (scripts/import/overpass.ts).
 */
import type { Parcours } from '@petit-cortege/shared';

/** Rayon d'extraction : un peu plus que la demi-bande, pour les objets qui la touchent. */
export const RAYON_EXTRACTION_M = 150;

/**
 * Requête Overpass QL : tout ce dont le décor a besoin, et aussi ce dont #13
 * aura besoin (bâtiments, ponts, places et leurs noms), pour rejouer sans réseau.
 */
export function requeteBande(parcours: Parcours, rayonM: number): string {
  const autour = `(around:${rayonM},${parcours.coordinates.map(([lon, lat]) => `${lat},${lon}`).join(',')})`;
  const chemins = ['highway', 'building', 'landuse', 'leisure', 'natural', 'waterway', 'place', '"area:highway"', 'man_made', 'bridge'];
  return [
    '[out:json][timeout:180];',
    '(',
    ...chemins.map((cle) => `  way${autour}[${cle}];`),
    `  relation${autour}["type"="multipolygon"];`,
    `  node${autour}["place"];`,
    ');',
    'out geom;',
  ].join('\n');
}
