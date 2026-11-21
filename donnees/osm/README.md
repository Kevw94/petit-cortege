# Données OpenStreetMap (ODbL)

Les fichiers de ce dossier sont extraits d'[OpenStreetMap](https://www.openstreetmap.org/) :

**© les contributeurs d'OpenStreetMap**, données disponibles sous la licence
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Voir <https://www.openstreetmap.org/copyright>.

Ils sont publiés ici sous la même licence (ODbL), indépendamment de la licence du code du dépôt (ADR 0006).

## Contenu

`republique-nation/` : manif de démonstration République → Nation par le boulevard Voltaire (Paris).

- `parcours.geojson` : parcours (LineString), coordonnées des chemins OSM du boulevard Voltaire et de la
  place Léon-Blum. Obtenu par :

  ```sh
  npm run decor -- parcours --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter \
    --rue "Boulevard Voltaire" --rue "Place Léon Blum" --depart 2.3633,48.8674 --arrivee 2.3959,48.8484 \
    --sortie donnees/osm/republique-nation/parcours.geojson
  ```

  (rejouable sans réseau avec `--osm donnees/osm/republique-nation/extrait-overpass.json` au lieu de `--overpass …`).

- `extrait-overpass.json` : réponse de l'API Overpass (miroir maps.mail.ru, extrait du 7 novembre 2026), réduite aux tags du décor (voir « Tags gardés »), pour
  une bande de 150 m autour du parcours (rues, espaces verts, eau, bâtiments, places) :

  ```sh
  npm run decor -- extraire --parcours donnees/osm/republique-nation/parcours.geojson \
    --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter \
    --sortie donnees/osm/republique-nation/extrait-overpass.json
  ```

Manifs du 14 novembre 2026 (`paris-2026-11-14/`, `nancy-2026-11-14/`, `caen-2026-11-14/`) : `extrait-overpass.json`,
réponse d'Overpass réduite aux tags du décor (bande de 150 m autour du parcours calculé), écrite par
`npm run import-manifs -- decors --fichier donnees/manifs/2026-11-14.json` (miroirs overpass.kumi.systems et maps.mail.ru,
14 novembre 2026) et rejouée sans réseau tant qu'elle existe. Les parcours sont dans `donnees/manifs/2026-11-14/`
(docs/import-manifs.md).

Manifs du 19 et du 21 novembre 2026 (`paris-2026-11-19/`, `paris-2026-11-21/`, `bordeaux-2026-11-21/`,
`marseille-2026-11-21/`) : même procédure (`donnees/manifs/2026-11-19.json`, `2026-11-21.json` et
`regions-2026-11-21.json`), extraits réduits par `npm run decor -- reduire` ; décors régénérés sans réseau identiques
octet pour octet aux décors publiés. Le plan de Paris du 21 novembre (6 Mo) n'est pas versionné (`.gitignore`).

### Plan de la ville

Le plan simplifié autour de la bande couvre un carré de plusieurs kilomètres (≈ 8 à 9 km de côté pour un défilé
parisien de 3 à 4 km, voir `client/public/decors/README.md`). Il est téléchargé par **pavés** d'au plus 3 km de côté
(une requête Overpass par pavé, pause de 5 s entre deux, chaque requête avec ses réessais et ses serveurs dans
l'ordre), sans bâtiments ni chemins (rues de `motorway` à `living_street` et `pedestrian`, places, espaces verts,
eau), puis réduit à ce que le rendu utilise (objets que le décor dessine, tags lus par le classement, sans noms ;
géométrie arrondie à 10⁻⁵ degré et simplifiée à 2 m), un élément par ligne. Les pavés déjà reçus sont gardés dans `<id>/.paves-plan/` (ignoré par
git) : une panne en cours de route ne fait pas tout reprendre ; un pavé refusé (délai dépassé) est redécoupé en
quatre : `plan-overpass.json`, lisible comme
une réponse Overpass (`lireExtrait`) et rejouable sans réseau. Ce fichier n'est versionné que s'il reste sous
≈ 3 Mo : versionné pour Nancy (0,7 Mo) et Caen (0,8 Mo) ; ignoré par git (`.gitignore`) pour République → Nation
(5,3 Mo) et Paris (6 Mo), à régénérer (≈ 10 à 40 min selon les serveurs) par :

```sh
NODE_USE_ENV_PROXY=1 npm run decor -- extraire-alentours --parcours donnees/osm/republique-nation/parcours.geojson \
  --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter --overpass https://overpass.kumi.systems/api/interpreter \
  --sortie donnees/osm/republique-nation/plan-overpass.json
```

(manifs du 14 novembre : `--parcours donnees/manifs/2026-11-14/<id>.geojson`, ou `npm run import-manifs -- decors`,
qui télécharge le plan absent). L'ancien `alentours-overpass.json` (700 m autour du parcours, format 2) n'est plus lu.

### Tags gardés

Les extraits de bande ne gardent que les tags que le décor lit (`scripts/decor/reduction.ts`) : ceux du
classement (`highway`, `area`, `area:highway`, `place`, `width`, `lanes`, `sidewalk`, `footway`, `tunnel`, `covered`,
`location`, `indoor`, `layer`, `waterway`, `natural`, `landuse`, `leisure`, `type`), `building`, et `name` sur les objets
du décor et sur toute surface : le contrôle des zones à éviter (`scripts/import/decors.ts`) compare le nom de chaque
surface (une zone interdite peut être une gare, une préfecture). Les éléments qui ne portent rien de tout cela sont
retirés, ainsi que les `bounds` et les nœuds des chemins qui ne sont pas des rues ; la géométrie est gardée telle quelle,
le décor généré est identique. Plus de `email`, `phone`, `website`, `contact:*`, `opening_hours`, `addr:*` ni
`wikidata` : publics dans OSM, les premiers sont des coordonnées de tiers inutiles ici. Un extrait enregistré avant ce
filtre se réduit sans réseau : `npm run decor -- reduire --osm <extrait.json>`.

La tilemap dérivée (base de données dérivée, ODbL elle aussi) est dans `client/public/decors/`.
