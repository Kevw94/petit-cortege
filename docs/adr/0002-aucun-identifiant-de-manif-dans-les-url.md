# Aucun identifiant de manif dans une URL

Supabase et un CDN journalisent les IP avec les URL demandées : une URL `/manif/123` relierait une IP à une manif dans des journaux qu'on ne contrôle pas. L'identifiant de manif ne transite donc jamais dans une URL : routage par fragment (`#/manif/123`, jamais envoyé au serveur), liste des manifs en cours chargée par une requête identique pour tous, entrée dans un cortège par POST/RPC avec l'identifiant dans le corps, pas de temps réel (ADR 0004).

En production (15 novembre 2026), il n'y a pas de CDN : https://petit-cortege.fr est servi par le VPS OVH de Strasbourg. L'identifiant reste hors de toute URL, y compris pour les journaux de ce serveur.

Hébergement en région UE, rétention des journaux la plus courte possible, et mention honnête du Cloud Act dans la page vie privée. Un hébergement maison sans journaux reste possible plus tard.

Ne pas « corriger » vers un routage par chemin ou des paramètres de requête.

## Conséquence : aperçu de lien générique

Les réseaux sociaux ne voient pas le fragment, donc pas la manif : l'aperçu de lien (Open Graph) est une seule image générique pour tout le site. Ne pas ajouter d'URL du type `/m/123` pour obtenir un aperçu par manif : elle remettrait l'identifiant dans les journaux.
