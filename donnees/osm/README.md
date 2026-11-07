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

La tilemap dérivée (base de données dérivée, ODbL elle aussi) est dans `client/public/decors/`.
