# Cortège déterministe, sans temps réel

La position d'un avatar se calcule côté client à partir du parcours, de l'heure de départ et de son heure d'entrée (≈ 2 km/h, plafonnée à la longueur du parcours ; les retardataires partent du point de départ). Il n'y a donc ni WebSocket ni présence : le client lit un instantané statique identique pour tous, servi par le même serveur, et rejoindre un cortège est un simple POST. Choisi pour le coût (100 000 soutiens = quelques euros de bande passante) et pour la vie privée (ADR 0002 : un fichier identique pour tous ne relie aucune IP à une manif).

## Mouvement

- Vitesse constante ≈ 2 km/h : `distance = 2 km/h × (maintenant − max(heure d'entrée, départ))`, plafonnée à la longueur du parcours.
- **Départ** = heure annoncée, décalable par un modérateur s'il est disponible (aucune astreinte).
- **Fin** = départ + longueur ÷ 2 km/h + marge (ex. 1 h). À la fin, les entrées se ferment et tout le cortège est considéré arrivé.
- Les retardataires partent du point de départ : le cortège s'étire naturellement. Entrer tôt place près de la tête.
- Si la vraie manif part en retard, le cortège virtuel est en avance : accepté (pas un outil d'information terrain).

## Conséquences

- Pas de statut « présent » ni de double compteur : mesurer la présence imposerait des signaux réguliers de chaque client.
- Les avatars au même point sont décalés de façon déterministe à partir de leur identifiant : tous les clients calculent la même foule.
- Réactions agrégées dans l'instantané et rejouées en vague côté client.
- Plus de réactions en V1 (chaque réaction serait un POST à protéger contre la triche) ; elles reviendront avec les chants.

## Fichiers servis

Tous identiques pour tous les clients, sans identifiant de manif dans l'URL (ADR 0002), format compact (indices d'apparence et de pancarte) :

- **Liste des manifs** : cache court (≈ 1 min), pour propager un départ décalé par un modérateur. Un départ décalé décale aussi la fin.
- **Entrées par minute** (toutes manifs confondues), URL datée, immuables, cache illimité ; compactées en un fichier par heure une fois l'heure terminée.
- **Retraits** (par le soutien ou par modération) : cache court, appliqués par le client par-dessus les fichiers immuables.

Le client affiche ses propres avatars immédiatement, sans attendre la publication, et les met en valeur localement (y compris dans l'image finale, où tout le cortège est rassemblé au point d'arrivée).
