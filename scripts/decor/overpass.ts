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
 * aura besoin (bâtiments, ponts, places et leurs noms, arbres), pour rejouer sans réseau.
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
    // Arbres isolés (alignements des boulevards, cours, squares) ; les rangées sont des chemins `natural`.
    `  node${autour}["natural"="tree"];`,
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

/** Boîte géographique en degrés, dans l'ordre des boîtes Overpass. */
export interface BoiteGeo {
  sud: number;
  ouest: number;
  nord: number;
  est: number;
}

/**
 * Requête Overpass QL du plan de la ville (ADR 0008) : sur une boîte géographique,
 * seulement ce que le plan dessine (rues carrossables et piétonnes, verts, eau, voies ferrées) ;
 * ni bâtiments ni chemins, trop lourds sur plusieurs kilomètres.
 */
export function requetePlan({ sud, ouest, nord, est }: BoiteGeo): string {
  const boite = `(${[sud, ouest, nord, est].map((n) => n.toFixed(6)).join(',')})`;
  return [
    '[out:json][timeout:300];',
    '(',
    `  way${boite}["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)(_link)?$"];`,
    `  way${boite}["leisure"~"^(park|garden|playground|pitch|dog_park)$"];`,
    `  way${boite}["landuse"~"^(grass|recreation_ground|village_green|cemetery|forest|meadow|allotments|basin|reservoir)$"];`,
    `  way${boite}["natural"~"^(water|wood|scrub|grassland)$"];`,
    `  way${boite}["waterway"~"^(river|canal|riverbank|dock)$"];`,
    `  way${boite}["railway"="rail"];`,
    `  relation${boite}["type"="multipolygon"][~"^(leisure|landuse|natural|waterway)$"~"."];`,
    ');',
    'out geom;',
  ].join('\n');
}
