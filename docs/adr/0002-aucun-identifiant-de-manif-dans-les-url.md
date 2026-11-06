# Aucun identifiant de manif dans une URL

Supabase et le CDN journalisent les IP avec les URL demandées : une URL `/manif/123` relierait une IP à une manif dans des journaux qu'on ne contrôle pas. L'identifiant de manif ne transite donc jamais dans une URL : routage par fragment (`#/manif/123`, jamais envoyé au serveur), liste des manifs en cours chargée par une requête identique pour tous, entrée dans un cortège par POST/RPC avec l'identifiant dans le corps, pas de temps réel (ADR 0004).

Hébergement en région UE, rétention des journaux la plus courte possible, et mention honnête du Cloud Act dans la page vie privée. Un hébergement maison sans journaux reste possible plus tard.

Ne pas « corriger » vers un routage par chemin ou des paramètres de requête.
