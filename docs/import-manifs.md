# Importer les manifs d'une journée

`npm run import-manifs` calcule le parcours de chaque manif à partir des étapes annoncées publiquement, génère son décor et la publie. Décision : ADR 0009. Rien n'est publié sans une vérification humaine (ADR 0003).

Pourquoi pas une API des tracés ? Il n'en existe pas : organisateurs, préfectures et presse publient des lieux (« de la République à la Nation »), parfois la liste des rues. Le tracé est donc **calculé** : géocodage des étapes, puis plus court itinéraire piéton qui passe par toutes. Seules les manifs au parcours annoncé publiquement peuvent devenir un cortège.

## 1. Écrire le fichier du jour

`donnees/manifs/<AAAA-MM-JJ>.json` (exemple : `donnees/manifs/2026-11-14.json`) :

```json
{
 "manifs": [
  {
   "id": "nancy-2026-11-14",
   "intitule": "Manifestation du 14 novembre",
   "ville": "Nancy",
   "depart": "2026-11-14T14:00",
   "parcoursAnnonce": "partira à 14h de la place Carnot, passera par la rue Stanislas, …",
   "etapes": [
    { "adresse": "Place Carnot, Nancy" },
    { "rue": "Rue Stanislas" },
    { "rue": "Boulevard Joffre" },
    { "adresse": "Place Carnot, Nancy" }
   ],
   "zonesEvitees": [{ "adresse": "Place Stanislas, Nancy", "rayonM": 50 }],
   "sources": [{ "libelle": "France 3 Grand Est", "url": "https://…" }],
   "verifie": { "declaree": "Déclarée en préfecture (source, date)", "sansInterdiction": null }
  }
 ]
}
```

- `id` : facultatif (par défaut `<ville>-<jour>`, comme `moderation`). `intitule` : neutre et factuel (ADR 0003).
- `depart` : heure de Paris (`2026-11-14T14:00`), le jour du fichier. `ouverture` facultative.
- `parcoursAnnonce` : la phrase publiée, **citée telle quelle**.
- `etapes`, du départ à l'arrivée, **uniquement ce qui est annoncé** :
  - `{ "adresse": "Place de la République, Paris" }` : un lieu (avec la ville) ;
  - `{ "rue": "Rue Stanislas" }` : une rue annoncée ; le cortège la parcourt entre ses croisements avec l'étape d'avant et celle d'après (géométrie OpenStreetMap) ; ni au départ ni à l'arrivée ;
  - `{ "position": [lon, lat], "libelle": "…" }` : un point explicite, quand un lieu ne se géocode pas (sourcer le point).
- `zonesEvitees` : lieux que le tracé ne doit pas traverser (périmètre interdit par arrêté), avec un rayon en mètres.
- `verifie` : comment et quand c'est vérifié, ou `null`. `publier` refuse la manif tant qu'un champ est `null`.
- `aVerifier` : raison pour laquelle la manif n'est ni tracée ni publiée (ex. étape trop vague : « quais »). Ne pas deviner une étape.

Contrôle sans réseau : `npm run import-manifs -- verifier --fichier donnees/manifs/2026-11-14.json`.

## 2. Tracer

```sh
npm run import-manifs -- tracer --fichier donnees/manifs/2026-11-14.json [--manif nancy-2026-11-14]
```

Pour chaque manif : géocodage de chaque étape (Géoplateforme IGN, repli API Adresse), géométrie OSM des rues (Overpass), itinéraire piéton (Géoplateforme IGN, repli OSRM FOSSGIS ; si le premier tracé fait demi-tour, les deux sont comparés et le meilleur est gardé), contrôles, puis `donnees/manifs/<jour>/<id>.geojson`.

Refusé (corriger l'étape indiquée et relancer) : score de géocodage < 0,7, résultat hors de la ville, rue absente d'OSM, tracé de moins de 200 m ou de plus de 15 km, plus court que le vol d'oiseau entre étapes ou plus de 1,8 fois plus long, étape à plus de 60 m du tracé, zone à éviter traversée. Signalé (à relire) : demi-tour, raccord non annoncé entre deux rues qui ne se croisent pas.

Derrière un proxy HTTPS (variable `HTTPS_PROXY`), lancer avec `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) pour que `fetch` passe par le proxy. Serveurs Overpass : `--overpass <url>` (répétable, essayés dans l'ordre).

## 3. Relire le tracé

Ouvrir le GeoJSON dans <https://geojson.io> ou uMap (import) et lire ses `properties` :

- `etapes` : libellé de la Base Adresse et score de chaque étape (un lieu découpé entre arrondissements est pris en son centre) ;
- `rues` : voies empruntées selon le service d'itinéraire (noms abrégés pour l'IGN, souvent vides pour OSRM) ;
- `avertissements`, `itineraire.ecartes`, `zonesEvitees` (distance au tracé).

Vérifier que le tracé suit des axes plausibles : entre deux lieux annoncés, le plus court chemin piéton peut prendre une petite rue que le cortège ne prendra pas. Si la source nomme les rues, les ajouter en étapes `rue` ; sinon ne rien forcer et le dire. En dernier recours, un tracé uMap reste possible (`npm run moderation -- creer-manif`).

Committer le fichier du jour et les GeoJSON : la publication se rejoue sans réseau.

## 4. Décors

```sh
npm run import-manifs -- decors --fichier donnees/manifs/2026-11-14.json
```

Extrait OSM brut de la bande de 150 m autour du parcours dans `donnees/osm/<id>/extrait-overpass.json`, et extrait simplifié du plan de la ville (carré couvrant le dézoom maximal, téléchargé par pavés de 3 km, sans bâtiments : rues, verts, eau ; seuls les tags utiles au rendu, géométrie arrondie) dans `donnees/osm/<id>/plan-overpass.json` (réutilisés s'ils existent ; `--rafraichir` pour les retélécharger), tilemap `client/public/decors/<id>.json` et entrée dans `index.json` (emprise, tracé simplifié, demi-largeur de la bande : le client prend le décor dont la bande couvre le parcours). Les places OSM traversées sont comparées aux zones à éviter. Les décors sont publiés avec le client (build).

## 5. Avant de publier : vérifier

Pour chaque manif (ADR 0003), noter dans `verifie` comment et quand c'est vérifié :

1. **Déclaration** : la manif est déclarée (préfecture, organisateurs, presse citant la préfecture).
2. **Absence d'arrêté d'interdiction** : recueil des actes administratifs de la préfecture, la veille ou le matin même ; à revérifier juste avant le départ (sinon `npm run moderation -- retirer-manif`).
3. **Source du parcours** : URL publique dans `sources`, phrase citée dans `parcoursAnnonce`.

## 6. Publier

```sh
DATABASE_URL=… DOSSIER_PUBLICATION=… npm run import-manifs -- publier --fichier donnees/manifs/2026-11-14.json
```

Sur le VPS (voir `docs/deploiement.md`), la commande `sudo pc-import-manifs publier --fichier /opt/petit-cortege/donnees/manifs/2026-11-14.json` fait la même chose avec la base et le dossier de publication de production.

Crée en base les manifs tracées et vérifiées (comme `moderation -- creer-manif`) et publie la liste. Sans réseau. Idempotent : une manif déjà créée est signalée et sautée. Refusées avec leur motif : vérification incomplète, `aVerifier`, pas de tracé, tracé périmé (étapes modifiées depuis « tracer »), manif déjà terminée. Code de sortie 1 s'il y a un refus.

## Licences et mentions

- Géocodage : Base Adresse Nationale via la Géoplateforme IGN ou l'API Adresse, **Licence Ouverte 2.0** (Etalab).
- Itinéraire Géoplateforme : IGN, BD TOPO®, **Licence Ouverte 2.0**.
- Rues annoncées, extraits et décors OSM, itinéraire OSRM FOSSGIS : **© les contributeurs d'OpenStreetMap, ODbL** (ADR 0006).
- Les GeoJSON tracés portent leurs mentions dans `properties.attribution`.
- Usage raisonnable des services publics : requêtes une à une, User-Agent neutre `petit-cortege-import/1` (aucune donnée personnelle), quelques réessais avec attente croissante.

## Limites

- Pas d'API nationale des tracés : une manif sans parcours annoncé ne peut pas devenir un cortège.
- Le tracé est un plus court chemin entre étapes : fidèle si l'annonce est détaillée, approximatif sinon.
- Les services (Géoplateforme, OSRM, Overpass) peuvent être lents ou en panne ; les miroirs Overpass sont inégalement disponibles.
