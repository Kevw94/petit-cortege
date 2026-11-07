# Test de charge (#19)

**Conclusion : « quelques euros pour 100 000 soutiens » est confirmé, avec des réserves.** Une manif de
100 000 soutiens simulée coûte environ **3,7 $ (≈ 3,4 €) de bande passante CDN** au tarif Bunny Europe,
si le CDN compresse les fichiers JSON (gzip). Sans compression, le coût monte à environ 11 $. Le serveur
tient le pic (≈ 550 entrées/s) une fois corrigé un goulot dans l'anti-rejeu ALTCHA : avant la correction,
il s'effondrait. Ces chiffres viennent d'une copie locale, pas de la production : il faudra les rejouer après
le déploiement (#18).

## Méthode

Il n'y a pas eu de déploiement (#18 n'est pas fait) : la simulation tourne sur une **copie locale**, dans le
conteneur de développement :

```sh
npm run build                                   # pour compter le poids de l'application
npm run charge -- --soutiens 100000             # ≈ 9 min réelles ; options : voir scripts/charge/charge.ts
```

- **Serveur** : le point d'entrée de production (`npm run serveur`, `server/src/lancement.ts`, ajouté par ce
  ticket), lancé dans son propre processus et configuré par l'environnement comme en prod. Une seule
  différence : une **horloge métier accélérée** (×30 par défaut, `scripts/charge/serveur-accelere.ts`).
  Postgres 16 local, base jetable `pc_charge_<hex>`.
- **Manif** : parcours de 4 km de type export uMap (150 points, lus par `lireParcoursGeoJson` comme la
  commande `creer-manif`), ouverture 1 h avant le départ, fin 3 h après le départ (2 h de marche + 1 h de marge).
  La fenêtre fait donc 4 h virtuelles, plus 15 min, soit ≈ 8,5 min réelles.
- **Affluence** (hypothèse, à recaler sur une vraie manif) : densité linéaire par morceaux. Elle monte de
  l'ouverture au départ, reste au pic pendant 15 min (≈ 16 % des entrées), puis décroît jusqu'à la fin
  (`profilParDefaut`). En temps accéléré, cela donne **≈ 550 entrées/s réelles au pic** et 30 à 150/s le
  reste du temps.
- **Soutiens** : chaque soutien fait le parcours complet du vrai client. Il demande un défi
  (`GET /api/defi`), calcule une **vraie preuve ALTCHA**, puis envoie `POST /api/entree` avec un hachage de
  jeton de retrait. Chaque soutien a sa propre IP (en-tête `X-Forwarded-For` derrière un proxy de confiance,
  comme derrière le CDN). La limite de 60 entrées/min/IP et le plafond global restent donc ceux de la prod.
  1 % des soutiens retirent ensuite leur avatar (`POST /api/retrait`).
  - Difficulté ALTCHA : le **coût PBKDF2 reste celui de la prod** (1 000 itérations : le serveur dérive une
    clé par défi, c'est son vrai coût). Le **compteur est réduit à 1–2** (`ALTCHA_COMPTEUR_MIN/MAX`) pour que
    le générateur puisse résoudre 100 000 preuves ; un vrai téléphone fait ≈ 4 000 fois plus de travail. La
    vérification côté serveur coûte un HMAC quel que soit le compteur.
- **Tâche de publication** : elle tourne pendant toute la charge, toutes les 5 s **virtuelles**, comme en prod
  en temps métier. En temps réel, les passages sont donc 30 fois plus fréquents qu'en prod (toutes les 167 ms
  au lieu de 5 s). C'est défavorable au serveur : le verrou exclusif de publication bloque plus souvent les
  entrées.
- **Clients simulés** (bande passante) : 400 clients tirés selon la même affluence. Deux tiers sont des
  soutiens, arrivés 1 min avant leur entrée ; un tiers sont des spectateurs (`--spectateurs 0.5` : 0,5
  spectateur par soutien). Chacun reste de 5 à 45 min (en moyenne 24,8 min). Ils exécutent le **vrai code du
  client** (`client/src/publication.ts`) au rythme de la vue manif : à l'arrivée puis toutes les 20 s, liste
  des manifs, fichiers d'entrées (minutes et heures, avec repli) et retraits. Ils lisent derrière un **faux
  CDN** (`scripts/charge/lecteurs.ts`, processus séparé) qui sert le dossier de publication et compte les
  octets, bruts et gzip (niveau 6), par client et par fichier. Les octets moyens par client sont ensuite
  extrapolés à 150 000 clients (100 000 soutiens + 50 000 spectateurs). On y ajoute l'application (build
  Vite, 4 fichiers) une fois par client et ≈ 200 octets d'en-têtes par réponse.
- **Mesures** : latences et statuts de chaque requête ; débit par seconde réelle ; CPU et mémoire (RSS) du
  processus serveur et CPU de tous les processus `postgres` (`/proc`, chaque seconde) ; durée de chaque
  passage de publication.
- **Vérification de cohérence** : à la fin, chaque entrée acceptée (201) doit figurer dans les fichiers par
  minute publiés (immuables). Résultat : **0 manquante** dans tous les essais.
- Le résultat détaillé est écrit dans `var/charge/<horodatage>.json` (non versionné).

## Résultats (100 000 soutiens, essai du 2026-11-07 11:51 UTC, après corrections)

Machine : conteneur à 4 cœurs (Intel Xeon 2,3 GHz), 15 Go de RAM, partagé avec le générateur, les clients
simulés et d'autres agents.

### POST d'entrée

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| `GET /api/defi` (ms) | 1,4 | 8,7 | 22 | 70 |
| `POST /api/entree` (ms), toute la manif | 3,1 | 45 | 91 | 273 |
| `POST /api/entree` (ms), quart d'heure du pic (≈ 545/s) | 5,4 | 93 | 162 | 273 |
| `POST /api/retrait` (ms) | 2,3 | 18 | 150 | 429 |

- 99 999 entrées acceptées sur 100 000. Le refus restant est un `manif-terminee` attendu : la dernière entrée
  tirée tombe à la seconde de fermeture. **Taux d'erreur ≈ 0 %**, aucun 429, aucun délai dépassé.
- Débit maximal : 587 entrées/s sur une seconde réelle, 543/s en moyenne pendant le pic. Au plus 163
  requêtes en vol.
- 970 retraits sur 970.

### Tâche de publication

2 471 passages, durée p50 43 ms, p95 74 ms, p99 93 ms, max 236 ms, 0 échec. Le compactage horaire (fichier de
12 h : 2,8 Mo, ≈ 34 000 entrées) tient dans le même ordre de grandeur. Le plus gros fichier par minute pèse
89 Ko (≈ 1 100 entrées).

### Serveur

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| CPU du processus Node (% d'un cœur) | 25 | 72 | 86 | 93 |
| CPU Postgres (tous processus, % d'un cœur) | 22 | 30 | 34 | 38 |
| CPU de la machine entière, banc compris (%) | 22 | 58 | 83 | 91 |

Mémoire du serveur : 184 Mo RSS au maximum.

Variabilité : un essai précédent, identique à part les mesures par tranche (11:39 UTC), a donné p95 = 3,0 s
au pic, sans erreur, avec 326 Mo RSS au maximum. La machine était partagée avec d'autres agents à ce
moment-là ; la cause exacte n'est pas établie. À surveiller lors du nouvel essai en production.

### Bande passante CDN

Moyenne par client simulé (session de 24,8 min, 75 rafraîchissements, 208 requêtes) :

| Fichier | brut | gzip |
|---|---|---|
| Liste des manifs (3,5 Ko brut / 1,25 Ko gzip, lue 75 fois) | 260 Kio | 92 Kio |
| Retraits (18 Ko brut / 13 Ko gzip en fin de manif, lus 75 fois) | 706 Kio | 500 Kio |
| Entrées par minute | 2 419 Kio | 690 Kio |
| Entrées par heure | 2 447 Kio | 691 Kio |
| Application (JS + CSS + HTML, une fois) | 1 380 Kio | 365 Kio |
| En-têtes (≈ 200 o × 208 requêtes) | 41 Kio | 41 Kio |
| **Total par client** | **7,1 Mio** | **2,3 Mio** |

Une entrée pèse ≈ 81 octets bruts et 23 octets gzip. Les 100 000 entrées font donc ≈ 8 Mo bruts et 2,3 Mo
gzip, et chaque client finit par en télécharger la partie publiée pendant sa présence.

**Total pour 150 000 clients : 365 Go en gzip, 1 114 Go en brut.**

| Tarif Bunny | gzip | brut |
|---|---|---|
| Standard, Europe et Amérique du Nord : 0,01 $/Go | **3,65 $** | 11,1 $ |
| Volume (moins de points de présence) : 0,005 $/Go | 1,83 $ | 5,6 $ |

Source du tarif : grille publique https://bunny.net/pricing/cdn/, en dollars, telle que connue en 2025 (date
de connaissance du modèle). **Elle n'a pas pu être revérifiée** : l'accès à bunny.net est bloqué depuis le
conteneur (proxy 403). Bunny facture aussi un minimum de 1 $/mois. L'euro est compté ≈ 0,9 $. La sortie du
VPS vers le CDN (origine) est négligeable : chaque fichier n'est tiré qu'une fois par point de présence, et
Hetzner inclut 20 To.

### Avant la correction (même scénario, 11:23 UTC)

Le serveur s'est effondré au pic : 35 % d'échecs (délais de 30 s dépassés, connexions coupées), p50 au pic de
30 s, jusqu'à 15 000 requêtes en vol, 815 Mo RSS. Un profil CPU (`npm run charge -- --profil-cpu`) a montré
la cause : `verifierEtConsommer` parcourait à chaque preuve **toute** la table anti-rejeu, soit jusqu'à
300 000 défis consommés sur 10 min. Le coût était donc quadratique.

## Corrections faites dans ce ticket

1. **Anti-rejeu ALTCHA en temps constant** (`creerMemoireAntiRejeu`, `server/src/preuve-travail.ts`) : la
   purge part des signatures les plus anciennes et s'arrête à la première encore valide. Test :
   `server/test/anti-rejeu.test.ts`, qui consomme 300 000 preuves en moins de 2 s.
2. **Coordonnées uMap arrondies à 6 décimales** (≈ 10 cm, `server/src/umap.ts`) : la liste des manifs, lue
   toutes les 20 s par chaque client, passe de 2,6 à 1,25 Ko gzip pour un parcours de 150 points. Test :
   `server/test/umap.test.ts`.
3. **Point d'entrée de production** `npm run serveur` (`server/src/lancement.ts`, `principal.ts`). Il exige
   `DATABASE_URL`, `DOSSIER_PUBLICATION`, `ALTCHA_CLE_HMAC` et `PROXYS_DE_CONFIANCE` (ex. `127.0.0.1,::1`,
   plus les plages du CDN si les POST passent par lui : le serveur écoute sur 127.0.0.1 derrière le serveur
   web, sans cela tous les soutiens partageraient la même limite par IP ; `aucun` pour s'en passer, avec un
   avertissement au démarrage), et accepte `PORT`, `INTERVALLE_PUBLICATION_MS`
   (5 000 par défaut) et `SERVIR_PUBLICATION=1`. La publication tourne en boucle sans chevauchement, et un
   passage plus long que l'intervalle produit un avertissement. Test : `server/test/lancement.test.ts`.

## Sensibilité de l'estimation (à lire avant de conclure)

- **Compression** : c'est le facteur le plus important (×3). Il faut vérifier en #18 que la zone Bunny
  compresse le JSON (gzip ou brotli) ; sinon, compresser les fichiers à l'origine.
- **Durée de présence** : chaque minute de présence coûte ≈ 53 Ko gzip (liste, retraits, nouvelles minutes).
  Si tous les clients restaient les 3 h de la manif, le total monterait à ≈ 1,6 To gzip, soit ≈ 16 $.
- **Retraits** : `retraits.json` contient les retraits de toutes les manifs publiées et il est relu toutes les
  20 s. Avec seulement 1 % de retraits, c'est déjà 22 % des octets. Il grossira avec le nombre de manifs
  passées (point ouvert de #7 : élaguer). Il est réécrit à chaque passage (champ `generee`), donc son
  contenu change toutes les 5 s et une revalidation (304) ne peut jamais réussir. Même chose pour la liste.
  Ne réécrire ces fichiers que si leur contenu change réellement permettrait des 304 quand le CDN et le
  navigateur revalident (`cache: 'no-cache'`). Gain non mesuré : le faux CDN ne simule pas les 304.
- **Journée nationale** : la liste contient toutes les manifs du jour avec leur parcours (≈ 1,25 Ko gzip par
  manif de 150 points). Avec 50 manifs, elle pèse ≈ 60 Ko gzip, soit ≈ 4,5 Mo par client sur 25 min et
  ≈ +7 $ pour 150 000 clients. Pistes : séparer les parcours (immuables) de l'état (départs, compteurs), ou
  relire la liste moins souvent.
- **Application** : 365 Kio gzip au moment de l'essai, comptés une fois par client. Après la fusion de #10
  et #12 (apparences, décor), le build pèse 498 Kio gzip (`client/dist` entier, décors compris), soit
  ≈ +20 Go et ≈ +0,2 $ pour 150 000 clients. Les visiteurs qui reviennent ont l'application en cache.
- **Spectateurs** : comptés à 0,5 par soutien (hypothèse). Le coût est proportionnel au nombre de clients.

## Ce qui diffère de la production, et à rejouer après #18

- **Machine** : conteneur à 4 cœurs partagé (générateur, clients simulés et serveur sur la même machine) au
  lieu d'un VPS Hetzner dédié. Les latences incluent la concurrence du banc pour le CPU, et un essai a varié
  d'un facteur 30 au p95.
- **Pas de TLS, pas de serveur web frontal, pas de CDN réel** : les POST arrivent en HTTP direct sur
  127.0.0.1. Le faux CDN ne simule ni le cache, ni les 304, ni la compression réelle de Bunny (gzip calculé
  localement).
- **Temps accéléré ×30** : la publication est 30 fois plus fréquente en temps réel qu'en prod (défavorable au
  serveur). Les défis expirent en temps réel (10 min), ce qui est sans effet ici.
- **Preuve ALTCHA allégée côté client** (compteur 1–2) : le temps de résolution sur téléphone n'est pas
  mesuré (point ouvert de #8).
- **Affluence et durée de session** : ce sont des hypothèses. Il faudra les recaler sur les journaux agrégés
  de la première vraie manif (sans IP).
- **À rejouer après #18** :
  - le même `npm run charge` depuis une machine extérieure contre le VPS, au travers du serveur web et du CDN
    (il faudra un mode « cible distante » : URL du serveur et du CDN en option) ;
  - un relevé de la facture ou des statistiques Bunny après une vraie manif ;
  - une vérification de la compression et des 304 sur la zone Bunny ;
  - une vérification du tarif en vigueur.
