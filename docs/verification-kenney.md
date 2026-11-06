# Vérification Kenney : style, licence et palette (ticket #3)

Conclusion : **ADR 0006 confirmé**, sans ajustement.

## Packs retenus

Copiés dans `assets/kenney/` (CC0), avec leur `License.txt` d'origine :

| Pack | Version | Fichier | Grille |
|---|---|---|---|
| Roguelike Modern City | 2.0 (29-10-2022) | `city/Spritesheet/roguelikeCity_transparent.png` | 37 × 28 tuiles, 16 px, marge 1 px |
| Roguelike Characters | 2.0 (20-05-2015) | `chars/Spritesheet/roguelikeChar_transparent.png` | 54 × 12 tuiles, 16 px, marge 1 px |
| Roguelike Base Pack (« RPG pack ») | 1.0 | `rpg/Spritesheet/roguelikeSheet_transparent.png` | 57 × 31 tuiles, 16 px, marge 1 px |

Le pack ville 2.0 est livré sous le nom `Tilemap/tilemap.png` ; il a été renommé `roguelikeCity_transparent.png` (nom de la version précédente du pack). Contenu identique pixel à pixel à l'ancienne planche `roguelikeCity_transparent.png`, une fois le fond magenta rendu transparent.

## Critères

- **Tileset urbain en vue 3/4** : rues (asphalte, marquages, trottoirs), bâtiments (toits en 9-slice, façades brique / pierre grise / pierre beige, portes, fenêtres), espaces verts, arbres. Eau, quais en pierre et berges naturelles : Roguelike Base Pack. Ponts : pièces de pont et de quai du Base Pack.
- **Personnages modulaires** : corps (3 teints humains de base, plus un vert non humain à exclure ; la gamme d'environ 6 teints se fait donc par changement de palette, comme prévu), cheveux, hauts, bas, chaussures, couvre-chefs, accessoires sur des colonnes séparées, superposables à la même position 16 × 16. Les casques, armures, armes et boucliers existent dans le pack : ils restent hors de la liste blanche (ADR 0003).
- **Licence** : les trois `License.txt` indiquent « Creative Commons Zero, CC0 ». kenney.nl n'était pas joignable depuis l'environnement de vérification ; les fichiers de licence proviennent des archives officielles du pack.
- **Style cohérent** : même série Roguelike, même grille, même contour sombre et même éclairage. Vérifié sur `docs/assets/planche-kenney.png`, reproductible avec `python3 docs/assets/planche-kenney.py assets/kenney planche.png`.
- **Palette compatible avec un changement de couleur par script** : les trois planches sont des PNG indexés (mode `P`), alpha binaire (0 ou 255 uniquement, donc aucun anticrénelage), 168, 78 et 169 couleurs opaques. Un changement de palette par correspondance exacte de couleurs est donc fiable.
