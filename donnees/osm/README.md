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

- `extrait-overpass.json` : réponse brute de l'API Overpass (miroir maps.mail.ru, extrait du 7 novembre 2026) pour
  une bande de 150 m autour du parcours (rues, espaces verts, eau, bâtiments, places) :

  ```sh
  npm run decor -- extraire --parcours donnees/osm/republique-nation/parcours.geojson \
    --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter \
    --sortie donnees/osm/republique-nation/extrait-overpass.json
  ```

Manifs du 14 novembre 2026 (`paris-2026-11-14/`, `nancy-2026-11-14/`, `caen-2026-11-14/`) : `extrait-overpass.json`,
réponse brute d'Overpass (bande de 150 m autour du parcours calculé), écrite par
`npm run import-manifs -- decors --fichier donnees/manifs/2026-11-14.json` (miroirs overpass.kumi.systems et maps.mail.ru,
14 novembre 2026) et rejouée sans réseau tant qu'elle existe. Les parcours sont dans `donnees/manifs/2026-11-14/`
(docs/import-manifs.md).

### Alentours

Chaque dossier contient aussi `alentours-overpass.json` : les alentours du parcours (700 m de part et d'autre, bande
comprise), pour la carte simplifiée autour de la bande détaillée. Ce n'est **pas** la réponse brute d'Overpass :
la requête ne demande ni bâtiments ni chemins (rues de `motorway` à `living_street` et `pedestrian`, places,
espaces verts, eau), puis l'extrait est réduit à ce que le rendu utilise (objets que le décor dessine, tags lus par
le classement, sans noms ; géométrie arrondie à 10⁻⁵ degré et simplifiée à 1,5 m), un élément par ligne. Il reste
lisible comme une réponse Overpass (`lireExtrait`) et rejouable sans réseau. Obtenu par
`npm run import-manifs -- decors` (manifs du 14 novembre) ou, pour la démo :

```sh
npm run decor -- extraire-alentours --parcours donnees/osm/republique-nation/parcours.geojson \
  --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter --overpass https://overpass.kumi.systems/api/interpreter \
  --sortie donnees/osm/republique-nation/alentours-overpass.json
```

La tilemap dérivée (base de données dérivée, ODbL elle aussi) est dans `client/public/decors/`.
