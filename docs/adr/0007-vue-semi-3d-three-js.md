# Vue de la manif en semi-3D avec Three.js, la 2D Phaser reste disponible

Le porteur veut suivre son avatar comme dans un jeu à la troisième personne (style 2,5D, Octopath / Don't Starve) : caméra derrière l'avatar (ou la tête du cortège), un peu au-dessus, en perspective, tournée dans le sens de la marche, avec un dézoom continu jusqu'à la vue de haut sur tout le parcours. Phaser est un moteur 2D : une perspective qui tourne avec le parcours y demanderait de réécrire projection, tri en profondeur et décor. La vue de la manif passe donc à **Three.js** (version exacte épinglée, 0.186.1), importé **dynamiquement** : il n'est téléchargé qu'à l'ouverture d'une manif en 3D (≈ 554 Ko, 141 Ko compressés), la liste des manifs n'en charge rien (+4 Ko pour l'interrupteur et les briques partagées).

## Ce qui ne change pas

- Le Cortège (fonction pure), le serveur, les fichiers publiés : la vue 3D affiche les mêmes sorties (positions, masse de foule, tirage des avatars, budget de 2 000 avatars dessinés).
- Les assets (ADR 0006) : sol cuit depuis la tilemap OSM Kenney (filtrage `NearestFilter`), bâtiments extrudés depuis les emprises de la tilemap et habillés de ses tuiles de toit, de mur et de fenêtre, avatars et paquets de foule composés depuis l'atlas d'apparence, pancartes dessinées par script. Rien n'est dessiné à la main, aucun modèle 3D tiers.
- Les noms des places et « © les contributeurs d'OpenStreetMap » restent visibles.
- La vue 2D Phaser reste disponible (interrupteur « Vue 2D » / « Vue 3D », mémorisé sur l'appareil) et sert de repli sans WebGL ; l'image finale (#15) reste en canvas 2D.

## Conséquences

- Deux rendus de la même vue à maintenir tant que la 2D est gardée ; les briques sans moteur (cuisson des tuiles, paquets de foule, pancartes sur canvas) sont partagées.
- Avatars en billboards instanciés (un appel de dessin par atlas) : face à la caméra, comme les sprites 2D ; vus de dos quand la caméra suit le cortège, faute de sprites de dos chez Kenney.
- Hauteur des bâtiments déterministe par bâtiment (15 à 24 m), pas tirée d'OSM ; à affiner si besoin (`building:levels`).
- Performance à confirmer sur de vrais téléphones (mesures en WebGL logiciel seulement) ; résolution plafonnée à 1,5 × les pixels CSS.
