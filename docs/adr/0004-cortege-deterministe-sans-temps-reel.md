# Cortège déterministe, sans temps réel

La position d'un avatar se calcule côté client à partir du parcours, de l'heure de départ et de son rang d'entrée : le cortège avance d'un bloc derrière sa tête (≈ 2 km/h, plafonnée à la longueur du parcours) et les retardataires se rangent à sa queue. Il n'y a donc ni WebSocket ni présence : le client lit un instantané statique identique pour tous, servi par le même serveur, et rejoindre un cortège est un simple POST. Choisi pour le coût (100 000 soutiens = quelques euros de bande passante) et pour la vie privée (ADR 0002 : un fichier identique pour tous ne relie aucune IP à une manif).

## Mouvement

- La tête suit l'horaire annoncé, à vitesse constante ≈ 2 km/h : `tête = 2 km/h × (maintenant − départ)`, plafonnée à la longueur du parcours. Elle avance même tant que le cortège est vide.
- Chaque avatar a une place fixe dans le cortège, `5` de front et une rangée tous les 2 m derrière la tête : `distance = tête − rang × 2 m`. Les places sont attribuées dans l'ordre d'entrée (heure d'entrée, ramenée au départ pour qui est entré avant, puis hachage de l'identifiant) : chacun vise, dans la première rangée incomplète, la colonne donnée par son hachage, et prend la case libre suivante.
- **Départ** = heure annoncée, décalable par un modérateur s'il est disponible (aucune astreinte).
- **Fin** = départ + longueur ÷ 2 km/h + marge (ex. 1 h). À la fin, les entrées se ferment et tout le cortège est considéré arrivé.
- Les retardataires rejoignent la queue du cortège là où elle est, pas le point de départ : le cortège reste groupé et s'allonge par l'arrière. Entrer tôt place près de la tête. Une place ne dépend que des entrées précédentes, donc ne bouge pas quand d'autres arrivent ; un retrait resserre les rangs derrière l'avatar retiré.
- Quand la tête arrive au bout du parcours, tout le cortège s'arrête avec elle ; les retardataires continuent de se ranger derrière la queue jusqu'à la fin.
- Le cortège ne dépasse jamais un avatar par tuile ; la masse de foule n'y vient que du budget d'avatars dessinés (et de l'image finale).
- Une foule entrée avant le départ, ou une file plus longue que le chemin déjà parcouru, a des rangées derrière la ligne de départ (distance négative).
- Si la vraie manif part en retard, le cortège virtuel est en avance : accepté (pas un outil d'information terrain).

## Conséquences

- Pas de statut « présent » ni de double compteur : mesurer la présence imposerait des signaux réguliers de chaque client.
- Les places sont calculées de façon déterministe à partir des entrées publiées : tous les clients calculent la même foule.
- Réactions agrégées dans l'instantané et rejouées en vague côté client.
- Plus de réactions en V1 (chaque réaction serait un POST à protéger contre la triche) ; elles reviendront avec les chants.

## Fichiers servis

Tous identiques pour tous les clients, sans identifiant de manif dans l'URL (ADR 0002), format compact (indices d'apparence et de pancarte) :

- **Liste des manifs** : cache court (≈ 1 min), pour propager un départ décalé par un modérateur. Un départ décalé décale aussi la fin.
- **Entrées par minute** (toutes manifs confondues), URL datée, immuables, cache illimité ; compactées en un fichier par heure une fois l'heure terminée.
- **Retraits** (par le soutien ou par modération) : cache court, appliqués par le client par-dessus les fichiers immuables.

Le client affiche ses propres avatars immédiatement, sans attendre la publication, et les met en valeur localement (y compris dans l'image finale, où tout le cortège est rassemblé au point d'arrivée).
