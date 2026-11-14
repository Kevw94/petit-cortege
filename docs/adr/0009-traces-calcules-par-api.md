# Tracés calculés par API à partir des étapes annoncées, validés à la main

Remplace « parcours tracé avec uMap » (périmètre V1). Il n'existe pas d'API publique des tracés de manifs en France : organisateurs, préfectures et presse publient des lieux de rendez-vous, parfois la liste ordonnée des rues et places. Le porteur ne veut plus tracer à la main. Le tracé est donc **calculé** à partir de ces étapes : géocodage (Géoplateforme IGN / Base Adresse Nationale, repli API Adresse), géométrie OSM des rues annoncées (Overpass) pour les parcourir entre leurs croisements, puis itinéraire piéton passant par toutes les étapes (Géoplateforme IGN, repli et comparaison OSRM FOSSGIS).

## Conséquences

- Un **fichier du jour** versionné (`donnees/manifs/<jour>.json`) liste ce qui a été annoncé (étapes citées, phrase publiée, sources) : on n'y ajoute aucune étape qui n'est pas annoncée. Une étape qui ne se géocode pas de façon fiable n'est pas devinée : la manif reste marquée `aVerifier`.
- Le tracé calculé est écrit en GeoJSON versionné (`donnees/manifs/<jour>/<id>.geojson`) avec les étapes géocodées, leurs scores, le service utilisé, les voies empruntées et les avertissements : relu par le porteur avant publication, rejouable sans réseau. Les tracés douteux (score faible, ville différente, détour, demi-tour, zone interdite traversée) sont refusés ou signalés, jamais publiés en silence.
- **Validation humaine avant publication** (ADR 0003) : `publier` refuse une manif tant que la déclaration et l'absence d'arrêté d'interdiction ne sont pas notées dans le fichier du jour, ou si le tracé ne correspond plus aux étapes.
- Le tracé suit le plus court chemin piéton entre les étapes : entre deux lieux annoncés, il peut emprunter une rue différente de celle du cortège réel. Plus l'annonce est détaillée, plus le tracé est fidèle. Seules les manifs au parcours annoncé peuvent devenir un cortège.
- uMap reste possible (`npm run moderation -- creer-manif --geojson …`) pour un parcours qu'aucune API ne sait reconstituer.
- Mentions : Géoplateforme IGN et BAN sous Licence Ouverte 2.0 ; OSM / OSRM sous ODbL.
