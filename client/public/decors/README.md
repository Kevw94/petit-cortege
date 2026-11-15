# Décors des manifs (ODbL)

Tilemaps Tiled générées depuis OpenStreetMap par `npm run decor -- tilemap …` (voir `scripts/decor.ts`).

**© les contributeurs d'OpenStreetMap** : ces cartes sont des bases de données dérivées d'OpenStreetMap,
publiées sous la licence [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(<https://www.openstreetmap.org/copyright>). La mention est affichée en jeu. Les tuiles graphiques sont de
Kenney (CC0) ; le code du dépôt garde sa propre licence (ADR 0006).

- `index.json` : liste des décors et de leur emprise. Le client charge l'index puis **tous** les décors listés
  (requêtes identiques pour tous, ADR 0002), et choisit celui qui couvre le parcours de la manif.
- `republique-nation.json` : République → Nation par le boulevard Voltaire (données sources dans `donnees/osm/`).
  Plans de la ville : République → Nation et Paris ≈ 8,7 et 9,2 km de côté (cases de 8 m), Nancy 3,4 km et Caen
  2,3 km (cases de 4 m). Poids de l'ensemble des décors (gzip -9) : ≈ 930 Ko (≈ 630 Ko avec les alentours à 700 m).
- `paris-2026-11-14.json`, `nancy-2026-11-14.json`, `caen-2026-11-14.json` : manifs du 14 novembre 2026, générées par
  `npm run import-manifs -- decors` (docs/import-manifs.md).

Chaque entrée de l'index porte aussi le tracé simplifié du parcours et la demi-largeur de la bande : le client prend
le décor dont la bande couvre le parcours, pas seulement l'emprise rectangulaire.

Régénérer (sans réseau tant que les deux extraits existent ; sinon ajouter `--overpass <url>`, répétable) :

```sh
npm run decor -- tilemap --parcours donnees/osm/republique-nation/parcours.geojson \
  --osm donnees/osm/republique-nation/extrait-overpass.json \
  --alentours-osm donnees/osm/republique-nation/plan-overpass.json \
  --sortie client/public/decors/republique-nation.json
```

Les cartes s'ouvrent dans Tiled (carte infinie, blocs de 32 × 32) pour un nettoyage à la main ; les chemins des
tilesets pointent vers `assets/kenney/`. Couches de tuiles : `sol` (rues, verts, eau, cours), `ponts`
(garde-corps), `batiments` (toits et murs) et `facades` (fenêtres, portes), ces deux dernières dessinées en jeu
par rangées avec profondeur = y ; couches d'objets : `parcours` (tracé) et `places` (noms des places
traversées, propriété `arrivee`).

**Plan de la ville** (format 3, couche de tuiles `alentours`) : autour de la bande détaillée, le plan simplifié de
la ville sur un carré centré sur le parcours, assez grand pour qu'au **dézoom maximal** (vue 3D de haut, cercle du
parcours à l'écran, caméra orientée n'importe comment) tout l'écran soit couvert, du téléphone en portrait 9:19,5 au
paysage 2560 × 1080, fondu compris (`empriseDuPlan`, `shared/src/decor.ts`) : demi-côté ≈ 2,7 × (rayon du parcours
+ 40 m) + 240 m de fondu, borné à 12 km de côté. La vue 2D borne son dézoom pour rester dans ce carré. Contenu
homogène sur tout le carré (pas d'anneau autour de la bande) : rues de `motorway` à `living_street` et `pedestrian`
(chaussée et trottoirs), places, espaces verts, eau, et entre les rues des pâtés de maisons sans bâtiments ni noms.
Chaque case couvre `tuiles_par_case` × `tuiles_par_case` tuiles, la même partout dans un plan : 4 (8 m) pour un
grand plan, 2 (4 m) pour un plan de moins de ≈ 4 km de côté ; blocs de 256 × 256 cases (zéros hors du carré), partant de la même origine que la carte et débordant de son emprise. La propriété `teintes_ilots` liste
les gids des teintes des îlots (gravier des cours, toits d'ardoise claire et de zinc, tuiles Kenney) : le client
donne à chaque îlot l'une d'elles (choix déterministe), comme la bande vue de loin. Dans Tiled, cette couche apparaît
réduite (à la moitié ou au quart de l'échelle) : à masquer pour nettoyer la bande. Le client en cuit une seule texture (un pixel par case,
couleur moyenne de la tuile), fondue au bord dans le fond beige (`#c1b191`), qui n'apparaît que si l'on déplace la
vue loin du parcours. L'emprise et la demi-largeur inscrites dans l'index restent celles de la bande : le choix du
décor ne change pas. Les cartes de format 2 (alentours à 700 m, blocs de 32 cases de 4 m) et sans alentours
(format 1) restent lues.
