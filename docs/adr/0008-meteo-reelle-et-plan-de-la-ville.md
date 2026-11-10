# Météo réelle relevée par le serveur, plan de la ville autour du décor

Le porteur veut que la vue d'une manif ressemble au temps qu'il fait sur place (ciel bleu s'il fait beau, pluie, nuit…), et qu'en dézoomant on voie la ville plutôt qu'un fond uni autour de la bande du décor.

## Météo

- **Relevée par le serveur, jamais par le client.** Le navigateur qui appellerait un service météo avec les coordonnées d'une manif enverrait à un tiers son IP à côté du lieu de cette manif, ce qu'interdit l'ADR 0002. La tâche de publication relève donc la météo au **départ du parcours** de chaque manif ouverte (au plus toutes les 15 min, nouvel essai 2 min après un échec), hors du verrou de publication, et la publie dans `manifs.json` (champ facultatif `meteo` : ciel, précipitation et sa force, température, heure du relevé). Absente après la fin ou si la source est en panne depuis le début ; sinon la dernière météo connue reste publiée.
- **Source : Open-Meteo** (sans clé, données CC BY 4.0, mention affichée sur la vue et dans les crédits). L'API publique est réservée à un usage non commercial : `METEO=<url>` pointe vers une instance hébergée ou l'offre commerciale au même format, `METEO=aucune` coupe la météo, `METEO=fictive:<code WMO>` fixe une météo sans réseau (démonstration en local).
- **Le client en tire une ambiance** (fonction pure `ambiance`) : couleurs du ciel selon la météo et la **hauteur du soleil** calculée au lieu de la manif (nuit, crépuscule), portée de la brume, lumière, pluie ou neige, éclairs. Vue 3D : ciel en dégradé, brume, lumières, sol et sprites assombris, particules animées dans le shader. Vue 2D : voile multiplié et précipitations en CSS. La nuit assombrit sans rendre la foule illisible.

## Plan de la ville

- `npm run decor -- plan` rasterise un extrait OSM **large** (≈ 1,5 km autour du parcours) en une image PNG à **4 m par pixel** : rues, voies piétonnes, verts, eau, voies ferrées sur un fond d'îlots, couleurs en sourdine (`COULEURS_PLAN`), bords fondus dans la couleur des îlots, qui est aussi celle du sol au-delà. Ni bâtiments ni chemins : trop lourds à extraire sur plusieurs kilomètres, et illisibles à cette échelle.
- Le plan est attaché à son décor dans `decors/index.json` (champ `plan`, avec sa géoréférence). Comme les décors, **tous les plans listés sont demandés** par chaque client (ADR 0002).
- Données dérivées d'OSM : le PNG est sous ODbL, comme les tilemaps (ADR 0006).

## Arbres

Les arbres du décor sont ceux d'OpenStreetMap (`natural=tree`, très complets à Paris grâce à l'import des arbres de la Ville, et rangées `tree_row` jalonnées tous les 10 m), dans une couche d'objets `arbres` de la tilemap : pas d'arbres inventés. Le générateur écarte ceux qui tombent sur la chaussée, dans l'eau, dans un bâtiment ou à moins de 6 m du parcours (le cortège fait 10 m de large). Sprites Kenney de la planche RPG (CC0, ADR 0006), deux tuiles de haut, à 6 × 12 m ; feuillus roux en automne selon la date de la manif, conifères si OSM dit `leaf_type=needleleaved`. Billboards instanciés en 3D (sans agrandissement de loin), sprites triés en profondeur avec les avatars en 2D.

## Accueil : police au feutre

La liste des manifs devient une rue (fond bitume) où chaque manif est un carton tenu à la main (pas une « pancarte » au sens du glossaire : ni slogan ni avatar), titré au feutre avec **Permanent Marker** (Font Diner, Apache 2.0), servie par le site (paquet `@fontsource`, jamais Google Fonts : une police chargée depuis un tiers lui donnerait l'IP des visiteurs, ADR 0002).

_Contredit ADR 0006 (« assets tiers : CC0 uniquement »)_, mais à rouvrir pour les polices : l'ADR vise à ne pas mélanger des licences à obligations de partage (CC BY-SA, GPL) avec les visuels ; Apache 2.0 est permissive, sans partage à l'identique, et ne s'applique qu'au fichier de police, crédité dans les mentions légales. Si le porteur préfère s'en tenir au CC0, revenir à la police système ne touche que `style.css`.

Les couleurs du plan et du ciel sont choisies à la main (constantes `COULEURS_PLAN`, palettes d'`ambiance`), pas tirées de la palette Kenney : ce sont des aplats de fond, pas des visuels de personnages ou de décor au sens de l'ADR 0006.

## Boutons et mode immersif

Les boutons de la vue reprennent les matières de l'accueil (bitume, carton, marquage jaune). La caméra est une barre d'icônes : leurs tracés SVG sont dessinés à la main dans `icones.ts`. L'ADR 0006 (« rien de dessiné à la main ») vise les visuels du jeu (décor, avatars, pancartes) ; ces pictogrammes d'interface en sont exclus. Chaque bouton garde son nom (`aria-label`, libellé au survol, mot court sous l'icône sur écran tactile). Le mode immersif masque toute l'interface sauf la mention OpenStreetMap, obligatoire, et un bouton de retour ; il passe en plein écran si le navigateur le permet.

## Conséquences

- Format v1 étendu sans changement de version : `meteo` et `plan` sont facultatifs, un ancien client les ignore.
- Un appel réseau sortant du serveur par manif ouverte et par quart d'heure ; une panne de la source n'arrête pas la publication.
- Le test de charge coupe la météo (horloge accélérée).
