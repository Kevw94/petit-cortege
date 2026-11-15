# Postgres + petit serveur sur un VPS dans l'UE, plutôt que Supabase

Sans temps réel (ADR 0004), Supabase n'apporte plus grand-chose, alors que l'ADR 0002 repose sur la maîtrise des journaux. La V1 tourne donc sur Postgres et un petit serveur (un POST d'entrée, une tâche qui écrit les fichiers) sur un VPS dans l'Union européenne. Les fichiers statiques et publiés sont servis par ce même serveur : il n'y a pas de CDN.

En production (15 novembre 2026), https://petit-cortege.fr est ce VPS chez OVH, société française, dans le centre de données de Strasbourg (SBG), sous Ubuntu 24.04. Nginx est le reverse proxy. Les scripts du dossier `deploiement/` décrivent encore une installation avec Caddy : ce n'est pas la machine en ligne.

Le Cloud Act américain vise les fournisseurs soumis au droit des États-Unis. OVH est une société française. Les pages légales le disent et n'affirment pas qu'elle échappe à cette loi.

## Conséquences

- Maintenance à notre charge : mises à jour, sauvegardes, supervision ; test de charge avant la première grosse manif.
- Le programme qui reçoit les entrées n'écrit pas d'adresse IP dans ses journaux. Il n'y a pas de journaux de CDN. La configuration Nginx de production n'est pas dans ce dépôt.
- L'ordre de grandeur visé au départ était d'environ 10 €/mois ; le tarif réel dépend de l'offre OVH.
