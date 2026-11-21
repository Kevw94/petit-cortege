/**
 * Extrait OSM réduit à ce que le décor lit (#38). Les réponses d'Overpass gardent tous les
 * tags, y compris des coordonnées de tiers (`email`, `phone`, `contact:*`, `website`…),
 * publiques dans OSM mais inutiles ici : on ne versionne que les tags lus par le code, et
 * seulement les éléments qui en portent un. La géométrie est gardée telle quelle : le décor
 * généré est identique à celui de l'extrait brut.
 */
import { TAGS_DU_CLASSEMENT } from './classement';
import { lireExtrait, type ElementOverpass, type ExtraitOverpass } from './osm';

/** Tags lus par le décor, hors `name` : le classement (`classement.ts`) et les bâtiments (`estBatiment`). */
const TAGS_DU_DECOR = new Set<string>([...TAGS_DU_CLASSEMENT, 'building']);

/**
 * Le nom est lu pour les rues suivies par l'itinéraire (`itineraire.ts`), les places
 * traversées (`places.ts`), et pour toute surface nommée par le contrôle des zones à éviter
 * (`zonesEntrees`, `import/decors.ts`) : une zone interdite peut être une gare, une
 * préfecture… Il est donc gardé sur toute surface, et sur tout objet du décor qui n'est pas
 * qu'un bâtiment (un chemin de bâtiment non fermé n'a pas de nom utile).
 */
const estSurface = (e: ElementOverpass) => lireExtrait({ elements: [e] }).some((o) => o.anneaux.length > 0);

/** Un tag du décor autre que `building` et `type` (qui ne fait que décrire une relation). */
const decritUnObjetDuDecor = (tags: Record<string, string>) =>
  Object.keys(tags).some((cle) => cle !== 'building' && cle !== 'type');

export function reduireExtrait(extrait: ExtraitOverpass): ExtraitOverpass {
  const elements: ElementOverpass[] = [];
  for (const e of extrait.elements) {
    const tags = Object.fromEntries(Object.entries(e.tags ?? {}).filter(([cle]) => TAGS_DU_DECOR.has(cle)));
    const nom = e.tags?.name;
    const nomUtile = nom !== undefined && (decritUnObjetDuDecor(tags) || estSurface(e));
    if (nomUtile) tags.name = nom;
    else if (!decritUnObjetDuDecor(tags) && tags.building === undefined) continue; // rien que le décor lise
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
 * Texte d'un extrait, relisible comme une réponse Overpass : l'en-tête d'Overpass (version,
 * date des données, mention ODbL) puis un élément par ligne (diffs lisibles).
 */
export function texteExtrait({ elements, ...entete }: ExtraitOverpass): string {
  const debut = JSON.stringify({ ...entete, elements: [] }).slice(0, -3); // jusqu’à « "elements": »
  return [`${debut}[`, elements.map((e) => JSON.stringify(e)).join(',\n'), ']}', ''].join('\n');
}
