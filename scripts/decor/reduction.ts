/**
 * Extrait OSM réduit à ce que le décor lit (#38). Les réponses d'Overpass gardent tous les
 * tags, y compris des coordonnées de tiers (`email`, `phone`, `contact:*`, `website`…),
 * publiques dans OSM mais inutiles ici : on ne versionne que les tags lus par le code, et
 * seulement les éléments qui en portent un. La géométrie est gardée telle quelle : le décor
 * généré est identique à celui de l'extrait brut.
 */
import { TAGS_DU_CLASSEMENT } from './classement';
import type { ElementOverpass, ExtraitOverpass } from './osm';

/**
 * Tags lus par le décor : le classement (`classement.ts`, rues, surfaces, eau ; repris par le
 * plan), les bâtiments (`estBatiment`) et les noms (`name`, voir `garderLeNom`).
 */
export const TAGS_DU_DECOR = [...TAGS_DU_CLASSEMENT, 'building'] as const;

/**
 * Le nom est lu pour les rues suivies par l'itinéraire (`itineraire.ts`), les places
 * traversées (`places.ts`) et les zones à éviter (`import/decors.ts`, surfaces nommées) : il
 * est gardé sur tout objet du décor sauf les bâtiments (noms de commerces, d'entreprises).
 */
const garderLeNom = (tags: Record<string, string>) =>
  Object.keys(tags).some((cle) => cle !== 'building' && cle !== 'type' && (TAGS_DU_DECOR as readonly string[]).includes(cle));

export function reduireExtrait<E extends ExtraitOverpass>(extrait: E): E {
  const elements: ElementOverpass[] = [];
  for (const e of extrait.elements) {
    const tags = Object.fromEntries(Object.entries(e.tags ?? {}).filter(([cle]) => (TAGS_DU_DECOR as readonly string[]).includes(cle)));
    if (Object.keys(tags).length === 0) continue;
    if (e.tags?.name !== undefined && garderLeNom(tags)) tags.name = e.tags.name;
    // Les nœuds d'un chemin ne servent qu'au graphe de l'itinéraire, le long des rues.
    const nodes = tags.highway !== undefined ? e.nodes : undefined;
    elements.push({
      type: e.type,
      id: e.id,
      ...(e.lat !== undefined && { lat: e.lat, lon: e.lon }),
      tags,
      ...(nodes !== undefined && { nodes }),
      ...(e.geometry !== undefined && { geometry: e.geometry }),
      ...(e.members !== undefined && { members: e.members }),
    });
  }
  return { ...extrait, elements };
}

/**
 * Texte de l'extrait réduit, relisible comme une réponse Overpass : l'en-tête d'Overpass
 * (version, date des données, mention ODbL) puis un élément par ligne (diffs lisibles).
 */
export function texteExtraitReduit(extrait: ExtraitOverpass): string {
  const { elements, ...entete } = reduireExtrait(extrait);
  const debut = JSON.stringify({ ...entete, elements: [] }).slice(0, -3); // jusqu’à « "elements": »
  return [`${debut}[`, elements.map((e) => JSON.stringify(e)).join(',\n'), ']}', ''].join('\n');
}
