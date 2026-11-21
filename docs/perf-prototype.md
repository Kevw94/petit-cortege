# Prototype de performance : 20 000 avatars (ticket #4)

Levée de risque avant l'apparence (#10), le décor et la masse de foule (#14) : combien d'avatars
Phaser 4 peut-il dessiner et faire marcher sur un téléphone d'entrée de gamme, et à partir de quand
faut-il passer en **masse de foule** ?

## Ce qui a été construit

- **Page de prototype** séparée du jeu (non incluse dans le build de production) :
  `client/prototype-perf.html?n=20000&technique=sprites|blitter|gpulayer&vue=tout|rue&maj=250`
  (`npm run dev`, puis `http://localhost:5173/prototype-perf.html?…`). Un bandeau affiche en continu
  images/s, coût du fil principal, avatars dessinés et tas JS : utilisable tel quel sur un vrai téléphone
  (`vite --host` est déjà configuré).
  - Scénario synthétique (`client/src/prototype-perf/scenario.ts`) : n entrées régulières sur 2 h après le
    départ, en secondes entières comme les heures publiées, sur un tracé de 6,5 km. **Les positions viennent
    du Cortège** (`calculerCortege`, avec le décalage latéral de #5) à chaque recalcul, à l'heure qui avance.
    À 2 km/h le cortège s'étale sur 4 km ; avec 5 colonnes de front, 20 000 avatars ≈ 2 avatars par tuile.
  - Avatars placeholders Kenney (corps + bas + haut + cheveux) **précomposés** une fois dans une texture
    128 × 128 (64 apparences) : un seul quad par avatar.
  - Trois techniques Phaser 4.2 : `sprites` (un `Image` par avatar, profondeur = y, élimination hors écran
    côté CPU), `blitter` (un `Blitter`, un `Bob` par avatar, pas de profondeur par Bob), `gpulayer`
    (`SpriteGPULayer` : tampon d'instances GPU, un seul appel de dessin ; positions écrites directement
    dans le tampon puis réenvoyé en entier).
  - Deux vues : `rue` = échelle de jeu (16 px = 2 m), caméra au milieu du cortège, ≈ 300 avatars visibles
    pour n = 20 000 ; `tout` = tout le tracé à l'écran, **chaque avatar dessiné en 16 px** (pire cas :
    vue d'ensemble ou image finale sans masse de foule).
  - `maj` : intervalle minimal entre deux recalculs du Cortège et des positions (0 = à chaque image).
- **Script de mesure reproductible** : `npm run mesure-perf -- [--n=…] [--techniques=…] [--vues=…]
  [--ralentis=4,6] [--majs=0,250] [--duree=5000] [--sortie=var/perf/x.json]`
  (`scripts/mesure-perf.ts`). Il fait un build Vite de production de la page seule, la sert en local et
  l'ouvre dans Chromium headless (Playwright) en profil **Moto G4** (360 × 640, tactile), avec ralentissement
  CPU CDP `Emulation.setCPUThrottlingRate`. Par configuration : nouveau contexte, 2 s de chauffe, puis
  échantillonnage requestAnimationFrame (images/s, durée d'image p95), coût du fil principal par pas Phaser
  (PRE_STEP → POST_RENDER), temps Cortège + placement + mise à jour des objets (« MAJ »), tas JS
  (`performance.memory`, CDP `Performance.getMetrics`). Navigateurs : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  dans ce conteneur.

## Limites de l'émulation (à lire avant les chiffres)

- **Aucun vrai téléphone.** Le « Moto G4 » est un profil Playwright (écran, tactile, user agent) ; la
  lenteur du CPU est simulée par CDP (×4 ≈ ce que Lighthouse utilise pour un Moto G4 ; ×6 plus sévère).
- **Le GPU n'est pas émulé.** En headless, WebGL est rendu **en logiciel** (ANGLE + SwiftShader) dans le
  processus GPU, sur les 4 cœurs de la machine hôte, et **n'est pas ralenti** par `setCPUThrottlingRate`
  (qui ne ralentit que le fil principal). Les images/s de la vue `tout` et de `gpulayer` mesurent donc
  surtout SwiftShader (remplissage et nuanceurs de sommets faits par le CPU), pas un Adreno/Mali.
- Le signal fiable est le **coût du fil principal** (JS : Cortège, objets Phaser, préparation des lots),
  qui est bien ralenti. Les images/s de la vue `rue` (peu de pixels) sont aussi parlantes.
- Les mesures varient de ± 20 % d'un passage à l'autre (machine partagée) ; ce sont des ordres de grandeur.

## Résultats

Passage principal : 96 configurations, 4 s de mesure chacune, `var/perf/resultats-principal.json`
(copie : `docs/perf-prototype-resultats.json`). Renderer : `ANGLE (Google, Vulkan 1.3.0 (SwiftShader
Device (Subzero)), SwiftShader driver)`. Valeurs : images/s (MAJ = ms par image passées dans Cortège +
placement + objets).

### Vue `rue` (échelle de jeu, ≈ 300 avatars visibles à n = 20 000)

| CPU | maj | technique | 1 000 | 5 000 | 10 000 | 20 000 |
|---|---|---|---|---|---|---|
| ×4 | chaque image | sprites | 60 | 58 | 48 | 28 (MAJ 28 ms) |
| ×4 | chaque image | blitter | 60 | 60 | 58 | 37 (MAJ 23 ms) |
| ×4 | chaque image | gpulayer | 60 | 13 | 8 | 4 |
| ×4 | 250 ms | sprites | 60 | 60 | 60 | **55** (MAJ 2,7 ms) |
| ×4 | 250 ms | blitter | 60 | 60 | 60 | **57** (MAJ 2,5 ms) |
| ×4 | 250 ms | gpulayer | 59 | 13 | 12 | 4 |
| ×6 | chaque image | sprites | 60 | 58 | 32 | 19 (MAJ 41 ms) |
| ×6 | chaque image | blitter | 60 | 59 | 37 | 22 (MAJ 39 ms) |
| ×6 | chaque image | gpulayer | 60 | 16 | 8 | 4 |
| ×6 | 250 ms | sprites | 60 | 60 | 58 | **53** (MAJ 3,4 ms) |
| ×6 | 250 ms | blitter | 60 | 60 | 58 | **54** (MAJ 3,3 ms) |
| ×6 | 250 ms | gpulayer | 60 | 16 | 9 | 5 |

### Vue `tout` (pire cas : n avatars dessinés en 16 px)

| CPU | maj | technique | 1 000 | 5 000 | 10 000 | 20 000 |
|---|---|---|---|---|---|---|
| ×4 | chaque image | sprites | 60 | 25 | 18 | 11 |
| ×4 | chaque image | blitter | 59 | 32 | 10 | 11 |
| ×4 | chaque image | gpulayer | 34 | 7 | 4 | 3 |
| ×4 | 250 ms | sprites | 60 | 27 | 10 | 10 |
| ×4 | 250 ms | blitter | 60 | 28 | 16 | 9 |
| ×6 | chaque image | sprites | 55 | 26 | 14 | 7 |
| ×6 | chaque image | blitter | 60 | 39 | 21 | 14 |
| ×6 | 250 ms | sprites | 60 | 35 | 21 | 9 |
| ×6 | 250 ms | blitter | 60 | 34 | 18 | 10 |

### Mémoire

Tas JS après chauffe : 7 à 25 Mo à 1 000 avatars, **25 à 80 Mo à 20 000** (pointe isolée à 127 Mo,
ramassage de miettes en cours), les écarts venant surtout des objets créés par `calculerCortege` à chaque
recalcul. Texture des avatars : 64 Kio. La mémoire GPU n'est pas mesurable dans cette émulation ; avec
une texture d'avatars et ≤ 20 000 quads (≈ 3 Mo de tampon pour `SpriteGPULayer`), elle n'est pas un risque.
Un Moto G4 a 2 Go de RAM : marge confortable.

### Passage complémentaire : coût du fil principal (sprites et Blitter, recalcul à 250 ms)

`var/perf/resultats-complement.json` (copie dans `docs/perf-prototype-resultats.json`), après correction de
la collecte du coût CPU. « CPU » = ms du fil principal par image (moyenne), du début du pas Phaser à la fin
de l'envoi du rendu.

| CPU | vue | technique | 1 000 | 5 000 | 10 000 | 20 000 |
|---|---|---|---|---|---|---|
| ×1 | tout | sprites | 60 i/s · 0,6 ms | 23 i/s · 4,0 ms | 28 i/s · 4,4 ms | 6 i/s · 20 ms |
| ×1 | tout | blitter | 60 · 0,4 | 28 · 1,5 | 26 · 2,4 | 15 · 5,7 |
| ×1 | rue | sprites | 60 · 0,2 | 60 · 0,5 | 60 · 0,8 | 60 · 1,5 |
| ×1 | rue | blitter | 60 · 0,2 | 60 · 0,3 | 60 · 0,5 | 60 · 0,7 |
| ×6 | tout | sprites | 60 · 2,7 | 31 · 15,5 | 20 · 39 | 9 · 102 |
| ×6 | tout | blitter | 60 · 1,5 | 35 · 8,2 | 18 · 18 | 8 · 44 |
| ×6 | rue | sprites | 60 · 1,2 | 60 · 2,5 | 58 · 4,6 | 51 · 8,4 |
| ×6 | rue | blitter | 60 · 1,0 | 60 · 2,0 | 41 · 3,0 | 56 · 3,7 |

Sans ralentissement, la vue `tout` tombe déjà à 23–28 images/s à 5 000 avatars dessinés alors que le fil
principal ne travaille que 1,5 à 4 ms : c'est la limite de **SwiftShader**, pas de Phaser. À ×6, le coût du
fil principal par avatar dessiné est d'environ **3 µs en sprites** et **1,7 µs en Blitter**.

### Rangs mémorisés (ticket #36)

Depuis #36, le Cortège se calcule en deux temps (`client/src/cortege/cortege.ts`) : les **rangs**
(hachage, tri des groupes d'entrée, grille, place sur la place d'arrivée) sont gardés par `CortegeMemorise`
et refaits seulement quand un avatar entre ou que les entrées, les propres, les retraits ou le départ changent ;
à chaque image, seules les **positions** à l'heure courante sont recalculées. Le prototype, la vue 2D et la
vue 3D l'utilisent (dans le prototype, `maj` ne règle donc plus que l'intervalle de recalcul des positions et
de leur conversion en pixels). Même machine, même passage, `npm run mesure-perf -- --n=10000,20000
--techniques=sprites,blitter --vues=rue --ralentis=4,6 --majs=0,250 --duree=4000`, vue `rue`, 20 000 avatars
(images/s · MAJ en ms par image) :

| CPU | maj | technique | avant | après |
|---|---|---|---|---|
| ×4 | chaque image | sprites | 13,9 · 61,7 | **33,9 · 18,1** |
| ×4 | chaque image | blitter | 14,7 · 60,7 | **43,1 · 15,2** |
| ×4 | 250 ms | sprites | 45,4 · 6,4 (p95 67 ms) | **58,9 · 1,2 (p95 17 ms)** |
| ×4 | 250 ms | blitter | 47,7 · 5,8 (p95 67 ms) | **59,7 · 1,1 (p95 17 ms)** |
| ×6 | chaque image | sprites | 9,2 · 94,3 | **26,1 · 23,2** |
| ×6 | chaque image | blitter | 9,7 · 94,6 | **32,5 · 20,6** |
| ×6 | 250 ms | sprites | 39,9 · 9,2 (p95 100 ms) | **54,8 · 2,3 (p95 33 ms)** |
| ×6 | 250 ms | blitter | 39,5 · 9,8 (p95 109 ms) | **58,7 · 1,4 (p95 17 ms)** |

**C'est le meilleur cas** : le scénario du prototype se place après la dernière entrée, les rangs ne sont
donc jamais refaits pendant la mesure. Pendant une vraie manif, ils le sont à chaque seconde où quelqu'un
entre (heures d'entrée à la seconde). Mesure sans ralentissement (Node, `scenarioPerf(20000)`, 1 h après le
départ, soit ≈ 10 000 avatars entrés et une entrée toutes les 0,36 s, 600 images de 16 ms) : `calculerCortege`
coûte 10,8 ms par image en moyenne (p95 16,7 ms), `CortegeMemorise` 1,3 ms (p95 1,8 ms), avec une image
sur ≈ 22 à 12,5 ms, celle où les rangs sont refaits. Après la dernière entrée, une image coûte ≈ 22 ms avec
`calculerCortege` et ≈ 3,6 ms avec `CortegeMemorise`. Ce qui reste à chaque image, c'est la position de chaque
avatar et, dans le prototype, sa conversion en pixels pour les 20 000.

## Analyse

1. **À l'échelle de jeu, 20 000 avatars en marche tiennent ≈ 55 images/s** (CPU ×4 et ×6), en sprites
   individuels comme en Blitter, **à condition de ne pas recalculer le Cortège à chaque image**. Le goulot
   n'est pas le rendu (≈ 300 avatars visibles) mais `calculerCortege` + placement sur les 20 000 avatars :
   ≈ 7 ms par recalcul sans ralentissement, 28 à 65 ms à ×4/×6. Même à 250 ms, l'image du recalcul fait un
   à-coup (p95 33–46 ms à ×6) : à étaler sur plusieurs images ou rendre incrémental. À 2 km/h et 16 px = 2 m, un avatar avance de
   4,4 px/s : recalculer toutes les 250 ms (pas de ≈ 1 px) est invisible en pixel art.
2. **Le nombre d'avatars dessinés par image est la vraie limite.** Dès 5 000 avatars dessinés, on passe sous
   30 images/s ; 10 000 à 20 000 donnent 10 à 20 images/s. Une grande partie de ce coût est SwiftShader (non
   représentatif), mais le coût CPU de Phaser par objet dessiné est réel : ≈ 3 µs par sprite et 1,7 µs par
   Bob à ×6 (15,5 ms pour 5 000 sprites), soit la moitié du budget d'une image à 30 images/s.
3. **`SpriteGPULayer` n'est pas concluant ici** : son nuanceur (animations par instance) traite chaque
   instance, visible ou non, et SwiftShader le fait sur le CPU ; même figé (`maj` infini), 20 000 instances
   ne dépassent pas ≈ 21 images/s. Sur un vrai GPU, 120 000 sommets par image sont peu de chose : c'est la
   piste la plus prometteuse pour la vue d'ensemble et l'image finale, **à mesurer sur un vrai téléphone**.
   Le réenvoi complet du tampon à chaque recalcul (≈ 3 Mo à 20 000) est à éviter : mouvements par
   animation linéaire du membre (non bouclée) et réécriture seulement quand un avatar change de tronçon.
4. **Sprites et Blitter se valent** à l'échelle de jeu. Les sprites gardent la profondeur = y (ADR / périmètre)
   et l'élimination hors écran est simple ; le Blitter, ≈ 2 fois moins cher par objet, n'a ni profondeur ni
   échelle par Bob (il faudrait trier le tableau des Bobs). Avantage aux **sprites** (`Image`) pour la vue de
   jeu ; le Blitter reste une option pour les avatars de premier plan d'une vue d'ensemble.

## Recommandations (pour #10 apparence et #14 masse de foule)

- **Seuil de densité : on garde « ≈ 1 avatar par tuile »** comme seuil de passage en masse de foule. Au-delà,
  les sprites 16 px se recouvrent entièrement (lisibilité) ; le rendu, lui, n'est pas le facteur limitant à
  l'échelle de jeu (≈ 300 visibles pour 20 000 avatars).
- **Budget dur : 2 000 avatars dessinés individuellement par image**, quel que soit le zoom (vue d'ensemble,
  image finale animée). Au-delà, masse de foule texturée + avatars au premier plan tirés par hachage
  de l'identifiant sous un seuil (tirage stable). 2 000 laisse de la marge sous la chute observée à 5 000
  (< 30 images/s) pour le décor (#12/#13), la pancarte (2ᵉ quad) et la mise en valeur de son avatar.
- **Recalcul du Cortège à 4 Hz** (toutes les 250 ms), pas à chaque image ; ou incrémental (groupes
  par instant de départ précalculés quand les entrées changent, toutes les 20 s). Placement en pixels avec
  longueurs cumulées précalculées (`client/src/prototype-perf/placement.ts`) plutôt que
  `positionDansLeCortege` (haversine à chaque appel).
- **Technique de rendu : un `Image` par avatar visible** (pool réutilisé, profondeur = y, élimination hors
  écran), apparences **précomposées** dans une texture (un quad par avatar, deux avec la pancarte).
  `SpriteGPULayer` à réévaluer sur un vrai téléphone pour la vue d'ensemble / l'image finale.
- **Image finale** : rendu unique (pas de cadence à tenir) : même avec 20 000 avatars dessinés, une image
  coûte ≈ 100–200 ms ici ; acceptable, mais la règle « masse de foule au-delà du seuil » s'applique aussi
  (périmètre V1).

## À confirmer sur un vrai téléphone

- Images/s des vues `tout` et `gpulayer` sur un vrai GPU mobile (Adreno 3xx/5xx, Mali-G52) : ouvrir
  `prototype-perf.html` depuis le téléphone sur le réseau local (`npm run dev`, adresse « Network » de Vite)
  et lire le bandeau. Appareils cibles : Moto G4/G5, Galaxy A10–A14, Redmi 9A.
- Coût réel du fil principal (les ×4/×6 sont une approximation) et thermique sur une marche de 2 h.
- Écran à haute densité (devicePixelRatio 2–3) : la page rend en pixels CSS (pas de multiplication par le
  DPR) ; si #10 rend à la résolution native, le coût de remplissage est multiplié par 4 à 9.
