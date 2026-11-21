# Cortège déterministe, sans temps réel

La position d'un avatar se calcule côté client à partir du parcours, de l'heure de départ, de la fin publiée et de son rang d'entrée : le cortège avance d'un bloc derrière sa tête (≈ 2 km/h), les retardataires se rangent à sa queue, et chacun entre à son tour sur la place d'arrivée, où tout le monde danse avant la photo finale. Il n'y a donc ni WebSocket ni présence : le client lit un instantané statique identique pour tous, servi par le même serveur, et rejoindre un cortège est un simple POST. Choisi pour le coût (100 000 soutiens = quelques euros de bande passante) et pour la vie privée (ADR 0002 : un fichier identique pour tous ne relie aucune IP à une manif).

## Mouvement

- La tête suit l'horaire annoncé, à vitesse constante ≈ 2 km/h : `tête = 2 km/h × (maintenant − départ)`. Elle avance même tant que le cortège est vide.
- Chaque avatar a une place fixe dans le cortège, `5` de front et une rangée tous les 2 m derrière la tête : `distance = tête − rang × 2 m`. Les places sont attribuées dans l'ordre d'entrée (heure d'entrée, ramenée au départ pour qui est entré avant, puis hachage de l'identifiant) : chacun vise, dans la première rangée incomplète, la colonne donnée par son hachage, et prend la case libre suivante.
- **Départ** = heure annoncée, décalable par un modérateur s'il est disponible (aucune astreinte).
- **Fermeture des entrées** = arrivée de la tête au bout du parcours (départ + longueur ÷ 2 km/h). Ensuite, plus personne ne rejoint : la longueur du cortège est connue.
- **Fin** = arrivée de la queue (`rangées × 2 m ÷ 2 km/h` après la tête, plafonnée à 1 h) + **10 min de danse**. Le serveur la calcule avec tous les avatars entrés, retirés compris (un retrait ne l'avance pas), et la publie dans la liste des manifs ; avant la fermeture elle ne peut que reculer, ensuite elle ne bouge plus. À la fin, l'image finale (la « photo ») devient disponible.
- Les retardataires rejoignent la queue du cortège là où elle est, pas le point de départ : le cortège reste groupé et s'allonge par l'arrière. Entrer tôt place près de la tête. Une place ne dépend que des entrées précédentes, donc ne bouge pas quand d'autres arrivent ; un retrait resserre les rangs derrière l'avatar retiré.
- **Place d'arrivée** : au bout du parcours, chaque avatar quitte la rue et marche (toujours à 2 km/h) jusqu'à sa place dans le rassemblement : un demi-disque devant le point d'arrivée, dans le prolongement du dernier tronçon, rempli du centre vers le bord dans l'ordre d'arrivée (spirale de Vogel, un avatar par tuile, rayon plafonné à 60 m, puis les avatars se serrent). Le cortège ne s'arrête donc plus quand la tête arrive : la queue continue d'avancer.
- **Danse finale** : les 10 dernières minutes, tout le cortège est sur la place, chacun à sa place, et danse (saut à chaque temps, ≈ 120 battements par minute, presque à l'unisson ; rien avec `prefers-reduced-motion`). Une queue plus longue qu'1 h de marche est considérée arrivée au début de la danse. À la fin, un flash marque la photo et l'image finale s'affiche.
- Dans la rue, le cortège ne dépasse jamais un avatar par tuile ; la masse de foule n'y vient que du budget d'avatars dessinés (et de l'image finale). Les avatars sur la place ne comptent pas dans la densité de la rue.
- Une foule entrée avant le départ, ou une file plus longue que le chemin déjà parcouru, a des rangées derrière la ligne de départ (distance négative).
- Si la vraie manif part en retard, le cortège virtuel est en avance : accepté (pas un outil d'information terrain).

## Retardataires : à la queue plutôt qu'au point de départ (révision)

Au départ, chaque avatar marchait depuis le point de départ à partir de son heure d'entrée (`distance = 2 km/h × (maintenant − max(heure d'entrée, départ))`) : un retardataire partait seul du début du parcours, loin derrière le reste du cortège, et le cortège s'étirait sur tout le parcours. C'est abandonné au profit de la queue, parce que :

- **Rejoindre, c'est être avec les autres** : un soutien qui arrive en cours de route doit se retrouver dans le cortège, pas seul sur un parcours vide. C'est le sens même du jeu (soutenir à distance, ensemble).
- **Un cortège groupé se lit mieux** : une seule foule qui avance, au lieu d'avatars éparpillés du départ jusqu'à la tête.
- **Les places sont stables** : chacun garde son rang dans le cortège ; avant, les vagues de retardataires entrés à quelques secondes d'écart se superposaient.

Ce qui reste vrai : le calcul est toujours déterministe et local (mêmes fichiers, même foule pour tous), sans temps réel ni présence ; entrer tôt place toujours près de la tête. Ce qui change en contrepartie : la masse de foule ne vient plus de la densité pendant la marche, seulement du budget d'avatars dessinés.

## Fin à l'arrivée de la queue, après la danse (révision)

Au départ, la fin tombait 1 h après l'arrivée de la tête, quel que soit le cortège : un petit cortège attendait une heure pour rien, et un long n'arrivait jamais vraiment. Désormais le cortège entre sur la place et la fin vient quand **le dernier** y est arrivé, après **10 min de danse**, puis la photo (image finale). Pour que cette heure soit connue, les **entrées ferment à l'arrivée de la tête** : sinon chaque nouveau soutien allongerait la queue et reculerait la fin. On perd la possibilité de rejoindre pendant l'heure qui suivait l'arrivée de la tête. Une queue très longue (≈ 10 000 soutiens = 4 km = 2 h de marche) est plafonnée à 1 h après la tête : au-delà, tout le monde est considéré arrivé sur la place pour la danse.

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
