/**
 * Extraction OSM par l'API Overpass : la bande autour du parcours, en
 * `out geom` (chemins et multipolygones avec leur géométrie).
 *
 * L'URL est configurable : overpass-api.de, ou un miroir
 * (ex. https://maps.mail.ru/osm/tools/overpass/api/interpreter).
 */
import type { Parcours } from '@petit-cortege/shared';
import type { ExtraitOverpass } from './osm';

export const URL_OVERPASS_PAR_DEFAUT = 'https://overpass-api.de/api/interpreter';
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

export async function telechargerExtrait(url: string, requete: string): Promise<{ texte: string; extrait: ExtraitOverpass }> {
  const reponse = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'petit-cortege-decor/1' },
    body: new URLSearchParams({ data: requete }).toString(),
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`Overpass (${url}) : HTTP ${reponse.status} ${texte.slice(0, 200)}`);
  const extrait = JSON.parse(texte) as ExtraitOverpass;
  if (!Array.isArray(extrait.elements)) throw new Error(`Overpass (${url}) : réponse sans « elements »`);
  return { texte, extrait };
}
