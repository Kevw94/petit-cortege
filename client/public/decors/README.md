# Décors des manifs (ODbL)

Tilemaps Tiled générées depuis OpenStreetMap par `npm run decor -- tilemap …` (voir `scripts/decor.ts`).

**© les contributeurs d'OpenStreetMap** : ces cartes sont des bases de données dérivées d'OpenStreetMap,
publiées sous la licence [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(<https://www.openstreetmap.org/copyright>). La mention est affichée en jeu. Les tuiles graphiques sont de
Kenney (CC0) ; le code du dépôt garde sa propre licence (ADR 0006).

- `index.json` : liste des décors et de leur emprise. Le client charge l'index puis **tous** les décors listés
  (requêtes identiques pour tous, ADR 0002), et choisit celui qui couvre le parcours de la manif.
- `republique-nation.json` : République → Nation par le boulevard Voltaire (données sources dans `donnees/osm/`).
- `republique-nation-plan.png` : plan de la ville autour du parcours (≈ 1,5 km, 4 m par pixel), vu quand on dézoome
  (ADR 0008). Attaché au décor dans `index.json` (champ `plan`).

Régénérer :

```sh
npm run decor -- tilemap --parcours donnees/osm/republique-nation/parcours.geojson \
  --osm donnees/osm/republique-nation/extrait-overpass.json --sortie client/public/decors/republique-nation.json
```

Plan de la ville (extrait Overpass d'environ 1,5 km autour du parcours, téléchargé en 4 × 4 morceaux, voir
`donnees/osm/README.md`) :

```sh
npm run decor -- plan --parcours donnees/osm/republique-nation/parcours.geojson \
  --overpass https://maps.mail.ru/osm/tools/overpass/api/interpreter --morceaux 4 \
  --decor client/public/decors/republique-nation.json
```

Les cartes s'ouvrent dans Tiled (carte infinie, blocs de 32 × 32) pour un nettoyage à la main ; les chemins des
tilesets pointent vers `assets/kenney/`. Couches de tuiles : `sol` (rues, verts, eau, cours), `ponts`
(garde-corps), `batiments` (toits et murs) et `facades` (fenêtres, portes), ces deux dernières dessinées en jeu
par rangées avec profondeur = y ; couches d'objets : `parcours` (tracé) et `places` (noms des places
traversées, propriété `arrivee`).
