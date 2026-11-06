# Périmètre V1

Objectif : valider que l'idée prend. Une seule boucle : **j'entre dans le cortège, je vois la foule grossir, je partage l'image finale.**

Contexte : porteur seul, sous pseudo, éditeur non professionnel (identité connue de l'hébergeur uniquement, LCEN), sans association ni dons. Hébergement ~10 €/mois. Voir `GLOSSARY.md` et `docs/adr/`.

## Dans la V1

- Liste des manifs ouvertes ; manifs saisies à la main par l'équipe (parcours tracé avec uMap → GeoJSON, sources citées), sélection sur l'ampleur (ADR 0003).
- « Rejoindre le cortège » : apparence de l'avatar (catalogue neutre, accessoires inclusifs) + pancarte (slogan générique + mise en forme).
- Un seul compteur « soutiens ».
- Retrait de son avatar (jeton en localStorage) ; mise en valeur locale de son propre avatar, pendant la marche et dans l'image finale.
- Image finale rendue côté client, PNG téléchargeable / partage natif ; aperçu de lien = image fixe par manif.
- Rappel via un `.ics` généré côté client, titre neutre (« Petit Cortège – voir la photo finale »).
- Anti-triche (ADR 0001) + outil minimal de suppression d'avatar sur signalement.
- Pages : mentions légales + adresse de signalement, vie privée (dont rétention des journaux), charte / « comment on choisit les manifs », CGU.
- Jouable sur mobile.
- Décor : script OSM semi-automatique + nettoyage manuel, pour 1 à 3 manifs ; 1 à 3 monuments.

## Hors V1

Notifications push, réactions, mini-jeu de chants, météo, prises de parole, chiffres officiels, organisateurs et slogans spécifiques, import Démosphère / Mobilizon, formulaire de proposition, monuments communautaires, texte libre sur les pancartes, association et dons.

À reconsidérer (association, dons, contact des organisateurs avec un kit identique pour tous) si le projet décolle, si une équipe se forme, ou avant un lancement public sur une grande journée nationale.

## Lancement

Discret, sur une grande journée nationale, sans démarchage des organisateurs. Diffusion organique : Mastodon, Reddit, communautés dev (open source + pixel art + vie privée), réseaux perso. Présenté comme « ouvert à toute manif légale ».

## Notes de mise en œuvre

- Vue 3/4 (style Stardew) ; tuile 16 px ≈ 2 m ; avatar 16 × 24 px ; carte chargée par blocs ; profondeur = position y.
- Décor depuis OSM (bande ≈ 200 m) : rues selon leur type, emprises de bâtiments en façades génériques, espaces verts, eau, ponts, noms des places traversées. Tracé du parcours au sol (ligne, flèches, départ, arrivée). Pas de commerces, POI, noms de rues ni mobilier.
- Chantier délicat : autotiling des emprises OSM (polygones quelconques) vers les pièces de bâtiment à taille fixe du tileset.
- Choisir le tileset CC0 avant de dessiner quoi que ce soit (ADR 0006).
- Au-delà d'un seuil de densité (≈ 1 avatar par tuile), masse de foule texturée, pendant la marche comme dans l'image finale. Avatars dessinés au premier plan : ceux dont le hachage de l'identifiant est sous un seuil (tirage stable quand des avatars arrivent ou partent).
- Pictos des pancartes : bibliothèque libre compatible (attention : OpenMoji est CC BY-SA, en conflit avec la règle CC0 de l'ADR 0006) ou dessinés maison. De loin, seuls couleur, forme et picto se voient ; le slogan est lisible au zoom ou sur son propre avatar.
- Si le style des sprites change, les anciennes images finales changent aussi : accepté (ou versionner le moteur de rendu).
