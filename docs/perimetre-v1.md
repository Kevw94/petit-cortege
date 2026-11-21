# Périmètre V1

Objectif : valider que l'idée prend. Une seule boucle : **j'entre dans le cortège, je vois la foule grossir, je partage l'image finale.**

Contexte : porteur seul, sous pseudo, éditeur non professionnel (identité connue de l'hébergeur uniquement, LCEN), sans association ni dons. Hébergement ~10 €/mois. Voir `GLOSSARY.md` et `docs/adr/`.

## Dans la V1

- Liste des manifs ouvertes ; manifs relevées par l'équipe dans un fichier du jour (étapes annoncées publiquement, sources citées), parcours calculé par API (géocodage + itinéraire piéton) puis relu et validé à la main avant publication (`npm run import-manifs`, ADR 0009 ; uMap reste possible), sélection sur l'ampleur (ADR 0003).
- « Rejoindre le cortège » : apparence de l'avatar (catalogue neutre, accessoires inclusifs) + pancarte (slogan générique + couleur + forme, sans picto).
- Un seul compteur « soutiens ».
- Retrait de son avatar (jeton en localStorage) ; mise en valeur locale de son propre avatar, pendant la marche et dans l'image finale.
- Image finale rendue côté client, PNG téléchargeable / partage natif ; aperçu de lien = une image générique pour tout le site (ADR 0002).
- Rappel via un `.ics` généré côté client, titre neutre (« Petit Cortège – voir la photo finale »).
- Anti-triche (ADR 0001) + outil minimal de suppression d'avatar sur signalement.
- Pages : mentions légales + adresse de signalement, vie privée (dont rétention des journaux), charte / « comment on choisit les manifs », CGU.
- Jouable sur mobile.
- Son synthétisé dans le navigateur (ADR 0008) : petite musique d'accueil, ambiance de foule dans la vue d'une manif, avec un fond de voix inintelligibles qui discutent (plus dense en marche et avec plus de soutiens), « Lancer un chant » local et sans paroles (le slogan de sa pancarte pulse en rythme), bouton pour couper le son, choix mémorisé sur l'appareil.
- Décor : script OSM semi-automatique + nettoyage manuel, pour 1 à 3 manifs ; aucun monument (place d'arrivée = place générique du tileset + nom de la place affiché). Aucun dessin à la main : Kenney CC0 + variantes et accessoires générés par script (ADR 0006).

## Hors V1

Notifications push, réactions, chants partagés en réseau et mini-jeu de chants, météo, prises de parole, chiffres officiels, organisateurs et slogans spécifiques, import Démosphère / Mobilizon, formulaire de proposition, monuments (dont communautaires), pictos sur les pancartes, texte libre sur les pancartes, association et dons.

À reconsidérer (association, dons, contact des organisateurs avec un kit identique pour tous) si le projet décolle, si une équipe se forme, ou avant un lancement public sur une grande journée nationale.

## Stack

Un seul langage partout : TypeScript.

- Client : TypeScript + Vite ; vue de la manif en semi-3D avec Three.js (importé à la demande), vue 2D et repli sans WebGL avec Phaser (ADR 0007).
- Serveur : TypeScript sur Node LTS, framework HTTP minimal, Postgres.
- Scripts (conversion OSM → tilemap Tiled, variantes de palette, génération des accessoires) : TypeScript, exécutés avec Node.
- Un seul dépôt, avec un module partagé qui définit une seule fois le format des fichiers publiés et les catalogues (apparence, pancartes, slogans), importé par le client, le serveur et les scripts.

## Lancement

Discret, sur une grande journée nationale, sans démarchage des organisateurs. Diffusion organique : Mastodon, Reddit, communautés dev (open source + pixel art + vie privée), réseaux perso. Présenté comme « ouvert à toute manif légale ».

## Notes de mise en œuvre

- Vue 3/4 (style Stardew) ; tuile 16 px ≈ 2 m ; avatar 16 × 16 px, soit une tuile (taille Kenney, sans redimensionnement) ; carte chargée par blocs ; profondeur = position y.
- Vue semi-3D (ADR 0007, `client/src/vue3d/`, par défaut si WebGL est disponible, choix 2D / 3D mémorisé sur l'appareil) : caméra derrière son avatar (ou la tête du cortège), orientée selon la corde du parcours un peu devant (elle tourne avant les virages, lissée), dézoom en échelle logarithmique jusqu'à la vue de haut sur tout le parcours (inclinaison de 30° à la verticale) ; glisser, tourner à deux doigts ou au clic droit détache la caméra, « Suivre » la rattache. Sol : tilemap cuite par blocs autour de la caméra, vue d'ensemble 1 px/tuile au-delà ; bâtiments : groupes de tuiles de bâtiment extrudés (maillage glouton, 15 à 24 m) ; avatars, pancartes et masse de foule en billboards instanciés (taille minimale à l'écran de loin) ; slogans écrits sur les pancartes vues de près seulement ; ses propres avatar et pancarte toujours visibles, avec halo et étiquette « toi ». Mesuré en émulation Pixel 5 (WebGL logiciel SwiftShader, 3 000 avatars) : 11 à 14 images/s de près et à mi-hauteur, 8 en vue de haut, contre 12 à 17 pour la 2D dans les mêmes conditions ; à confirmer sur de vrais téléphones.
- Décor depuis OSM (bande ≈ 200 m) : rues selon leur type, emprises de bâtiments en façades génériques, espaces verts, eau, ponts, noms des places traversées. Tracé du parcours au sol (ligne, flèches, départ, arrivée). Pas de commerces, POI, noms de rues ni mobilier. Autour de la bande, le **plan de la ville** simplifié (rues, places, verts, eau, pâtés de maisons dans les teintes des toits et des cours de la bande, sans bâtiments en volume ni noms), homogène sur un carré assez grand pour couvrir tout l'écran au dézoom maximal centré sur le parcours, du téléphone en portrait au 21:9 (plusieurs kilomètres de côté à Paris, borné à 12 km), à résolution réduite, la même sur tout le plan (cases de 8 m, 4 m pour un petit plan) ; son bord se fond dans un fond beige, visible seulement en déplaçant la vue loin du parcours.
- Décor (#12) : `npm run decor -- extraire | extraire-alentours | tilemap | parcours` (Overpass à URLs configurables, essayées dans l'ordre, ou extraits JSON locaux) → carte Tiled infinie en blocs de 32 × 32 dans `client/public/decors/` (ODbL), extraits réduits aux tags du décor dans `donnees/osm/`. Le client demande l'index puis **tous** les décors listés, pour ne pas révéler la manif consultée (ADR 0002).
- Chantier délicat : autotiling des emprises OSM (polygones quelconques) vers les pièces de bâtiment à taille fixe du tileset.
- Assets : décor et personnages modulaires Kenney CC0 (Roguelike Modern City, Roguelike Characters) ; eau et berges (quais en pierre, berges naturelles) du Roguelike RPG pack, même série ; variantes d'apparence (teint, cheveux, vêtements) par script de changement de palette, dont une gamme d'environ 6 teints ; accessoires inclusifs (fauteuil, poussette, canne) générés par script dans la palette Kenney (ADR 0006).
- Au-delà d'un seuil de densité (≈ 1 avatar par tuile), masse de foule texturée, pendant la marche comme dans l'image finale. Avatars dessinés au premier plan : ceux dont le hachage de l'identifiant est sous un seuil (tirage stable quand des avatars arrivent ou partent).
- Performance (prototype #4, `docs/perf-prototype.md`, mesuré en émulation Moto G4, CPU ×4–×6, WebGL logiciel ; à confirmer sur un vrai téléphone) : seuil de densité confirmé à ≈ 1 avatar par tuile, plus un **budget dur de 2 000 avatars dessinés individuellement par image**, quel que soit le zoom (au-delà : masse de foule + premier plan tiré par hachage). À l'échelle de jeu, 20 000 avatars en marche tiennent ≈ 55 images/s (≈ 300 visibles) si le Cortège est recalculé à ≈ 4 Hz et non à chaque image (sinon 19–37 images/s). Rendu : un `Image` Phaser par avatar visible (profondeur = y, élimination hors écran), apparences précomposées dans une texture ; `SpriteGPULayer` à réévaluer sur un vrai GPU pour la vue d'ensemble.
- Animation de marche (`client/src/cortege/marche.ts`, procédurale, sans asset) : les avatars qui avancent (`enMarche` du Cortège : départ passé, dans la rue ou en route vers sa place sur la place d'arrivée) sautillent d'un pixel de l'atlas (≈ 0,125 m) et se balancent légèrement (demi-pixel en 2D, ≈ 2,5° en 3D) à ≈ 1,8 pas/s, chacun à sa phase tirée de son identifiant ; la pancarte suit avec un petit retard, le halo « toi » reste fixe ; la masse de foule ondule par paquet là où elle avance. Immobiles avant le départ, une fois à leur place sur la place d'arrivée, manif terminée ou avec `prefers-reduced-motion`. Danse finale (10 dernières minutes) : tous sautent de 3 pixels de l'atlas à ≈ 2 temps/s, déhanchés et pancartes agitées, presque à l'unisson (`allureDeDanse`). Purement visuel : positions du Cortège inchangées ; en 3D, décalages calculés côté CPU à l'ajout des billboards (un attribut d'inclinaison par instance).
- Pancartes : de loin, seules la couleur et la forme se voient ; le slogan est lisible au zoom ou sur son propre avatar.
- Si le style des sprites change, les anciennes images finales changent aussi : accepté (ou versionner le moteur de rendu).
