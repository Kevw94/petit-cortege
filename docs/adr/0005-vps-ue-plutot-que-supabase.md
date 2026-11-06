# Postgres + petit serveur sur VPS UE, CDN UE, plutôt que Supabase

Sans temps réel (ADR 0004), Supabase n'apporte plus grand-chose, alors que l'ADR 0002 repose sur la maîtrise des journaux. La V1 tourne donc sur Postgres et un petit serveur (un POST d'entrée, une tâche qui écrit les fichiers) sur un VPS Hetzner dans l'UE, avec les fichiers statiques sur le CDN Bunny dans l'UE : hors Cloud Act, journaux sous contrôle, ~10 €/mois.

## Conséquences

- Maintenance à notre charge : mises à jour, sauvegardes, supervision ; test de charge avant la première grosse manif.
- Journaux du serveur web configurés sans IP (les POST arrivent sur le VPS, pas sur le CDN) ; journaux Bunny désactivés ou anonymisés.
