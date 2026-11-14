/**
 * API Overpass (OpenStreetMap, ODbL) avec plusieurs serveurs essayés dans
 * l'ordre : l'instance principale refuse parfois les connexions, les miroirs
 * sont lents ou saturés selon l'heure.
 */
import type { ExtraitOverpass } from '../decor/osm';
import { ErreurService, requeteTexte, type Reseau } from './reseau';

export const URLS_OVERPASS_PAR_DEFAUT = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/** Délai par serveur : les grosses bandes (≈ 4 km de parcours) prennent 20 à 60 s. */
const DELAI_OVERPASS_MS = 180_000;

export interface ReponseOverpass {
  texte: string;
  extrait: ExtraitOverpass;
  url: string;
}

export async function interrogerOverpass(
  reseau: Reseau,
  urls: string[],
  requete: string,
  journal: (ligne: string) => void = () => {},
): Promise<ReponseOverpass> {
  const pannes: string[] = [];
  for (const url of urls) {
    try {
      const texte = await requeteTexte({ essais: 2, delaiMs: DELAI_OVERPASS_MS, ...reseau }, url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: requete }).toString(),
      });
      const extrait = JSON.parse(texte) as ExtraitOverpass;
      if (!Array.isArray(extrait.elements)) throw new ErreurService(`${new URL(url).host} : réponse sans « elements »`);
      return { texte, extrait, url };
    } catch (e) {
      if (!(e instanceof ErreurService) && !(e instanceof SyntaxError)) throw e;
      const message = e instanceof SyntaxError ? `${new URL(url).host} : réponse illisible` : e.message;
      pannes.push(message);
      journal(`  Overpass indisponible (${message}), serveur suivant…`);
    }
  }
  throw new ErreurService(`Overpass : aucun serveur n'a répondu (${pannes.join(' ; ')}).`);
}
