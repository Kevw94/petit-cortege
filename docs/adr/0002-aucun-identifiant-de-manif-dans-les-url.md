# Aucun identifiant de manif dans une URL

> **Exception (ADR 0010).** La page publique d'une manif est servie en `/manif/<id>` pour que les moteurs puissent l'indexer. Le reste de cette décision tient : pas d'identifiant dans les chemins des fichiers publiés, ni dans l'URL de l'API d'entrée (l'identifiant reste dans le corps du POST).

Supabase et un CDN journalisent les IP avec les URL demandées : une URL `/manif/123` relierait une IP à une manif dans des journaux qu'on ne contrôle pas. L'identifiant de manif ne transite donc pas dans les URL de l'API ni dans les chemins des fichiers publiés : la liste des manifs est chargée par une requête identique pour tous, l'entrée dans un cortège se fait par POST avec l'identifiant dans le corps, pas de temps réel (ADR 0004).

En production (15 novembre 2026), il n'y a pas de CDN : https://petit-cortege.fr est servi par le VPS OVH de Strasbourg. Le programme n'écrit pas d'adresse IP. Le reverse proxy ne conserve pas de journal d'accès (ADR 0010).

La mesure d'audience (Umami, auto-hébergée sur le même VPS ; page vie privée) n'enregistre pas l'adresse IP. Elle voit la page ouverte, y compris `/manif/<id>`.

Hébergement en région UE, rétention des journaux la plus courte possible, et mention honnête du Cloud Act dans la page vie privée. Un hébergement maison sans journaux reste possible plus tard.

Ne pas remettre l'identifiant de manif dans les paramètres de requête, ni dans les chemins de `/api/` ou de `/publie/`. La seule exception est la page publique `/manif/<id>` (ADR 0010).

## Aperçu de lien

L'accueil garde un aperçu générique. La page `/manif/<id>` porte le sien (titre, description, image du site) : c'est le HTML servi par le serveur, pas une réécriture en JavaScript.
