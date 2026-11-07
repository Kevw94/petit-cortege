# Décors des manifs (ODbL)

Tilemaps Tiled générées depuis OpenStreetMap par `npm run decor -- tilemap …` (voir `scripts/decor.ts`).

**© les contributeurs d'OpenStreetMap** : ces cartes sont des bases de données dérivées d'OpenStreetMap,
publiées sous la licence [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(<https://www.openstreetmap.org/copyright>). La mention est affichée en jeu. Les tuiles graphiques sont de
Kenney (CC0) ; le code du dépôt garde sa propre licence (ADR 0006).

- `index.json` : liste des décors et de leur emprise. Le client charge l'index puis **tous** les décors listés
  (requêtes identiques pour tous, ADR 0002), et choisit celui qui couvre le parcours de la manif.
- `republique-nation.json` : République → Nation par le boulevard Voltaire (données sources dans `donnees/osm/`).

Régénérer :

```sh
npm run decor -- tilemap --parcours donnees/osm/republique-nation/parcours.geojson \
  --osm donnees/osm/republique-nation/extrait-overpass.json --sortie client/public/decors/republique-nation.json
```

Les cartes s'ouvrent dans Tiled (carte infinie, blocs de 32 × 32, couche `sol`, couche d'objets `parcours`)
pour un nettoyage à la main ; les chemins des tilesets pointent vers `assets/kenney/`.
