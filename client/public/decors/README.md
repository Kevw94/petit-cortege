# Décors des manifs (ODbL)

Tilemaps Tiled générées depuis OpenStreetMap par `npm run decor -- tilemap …` (voir `scripts/decor.ts`).

**© les contributeurs d'OpenStreetMap** : ces cartes sont des bases de données dérivées d'OpenStreetMap,
publiées sous la licence [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(<https://www.openstreetmap.org/copyright>). La mention est affichée en jeu. Les tuiles graphiques sont de
Kenney (CC0) ; le code du dépôt garde sa propre licence (ADR 0006).

- `index.json` : liste des décors et de leur emprise. Le client charge l'index puis **tous** les décors listés
  (requêtes identiques pour tous, ADR 0002), et choisit celui qui couvre le parcours de la manif.
- `republique-nation.json` : République → Nation par le boulevard Voltaire (données sources dans `donnees/osm/`).
- `paris-2026-11-14.json`, `nancy-2026-11-14.json`, `caen-2026-11-14.json` : manifs du 14 novembre 2026, générées par
  `npm run import-manifs -- decors` (docs/import-manifs.md).

Chaque entrée de l'index porte aussi le tracé simplifié du parcours et la demi-largeur de la bande : le client prend
le décor dont la bande couvre le parcours, pas seulement l'emprise rectangulaire.

Régénérer :

```sh
npm run decor -- tilemap --parcours donnees/osm/republique-nation/parcours.geojson \
  --osm donnees/osm/republique-nation/extrait-overpass.json --sortie client/public/decors/republique-nation.json
```

Les cartes s'ouvrent dans Tiled (carte infinie, blocs de 32 × 32) pour un nettoyage à la main ; les chemins des
tilesets pointent vers `assets/kenney/`. Couches de tuiles : `sol` (rues, verts, eau, cours), `ponts`
(garde-corps), `batiments` (toits et murs) et `facades` (fenêtres, portes), ces deux dernières dessinées en jeu
par rangées avec profondeur = y ; couches d'objets : `parcours` (tracé) et `places` (noms des places
traversées, propriété `arrivee`).
