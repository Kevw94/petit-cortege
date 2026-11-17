# Pages publiques des manifs, indexables

Une adresse en fragment (`#/manif/<id>`) n'est pas demandée au serveur et n'est pas indexée : Google ne voit qu'une seule page, l'accueil. Chaque manif a donc une page `/manif/<id>`, où `<id>` est déjà l'identifiant public (ville et date, par exemple `paris-2026-11-21`).

La page est produite à la demande par le serveur, depuis la base. Une manif créée après le build (`pc-moderation creer-manif`) a sa page sans reconstruction du client. Le HTML initial contient le titre, le texte, les sources et les données structurées ; il charge ensuite la même application, qui s'ouvre sur ce cortège.

## Ce qui ne change pas

- L'entrée dans un cortège envoie l'identifiant dans le corps du POST, pas dans l'URL (ADR 0002).
- Les fichiers publiés (`/publie/manifs.json`, entrées, retraits) n'ont pas d'identifiant de manif dans leur chemin. Ils restent les mêmes pour tout le monde.
- Le programme n'écrit ni adresse IP ni adresse demandée dans ses journaux.
- Le reverse proxy ne conserve pas de journal d'accès : l'adresse `/manif/…` contient l'identifiant public, et un journal d'accès l'associerait à une IP. Caddy ne journalise déjà pas les accès. Nginx, en production, doit avoir `access_log off` sur ces adresses (voir `docs/deploiement.md`).

## Indexation

- Le sitemap, lui aussi produit à la demande, liste l'accueil et chaque manif non retirée (ouverte, à venir ou terminée), avec `lastmod`.
- Une manif retirée par la modération répond 410 et `noindex`, et sort du sitemap.
- Une manif inconnue répond 404 et `noindex`.
- Une manif terminée reste en ligne. La page le dit. L'application s'ouvre encore sur son cortège, y compris après qu'elle a quitté la liste publiée (30 jours).

## Présence

Le cortège est en ligne et la manif a lieu dans une ville. Les données structurées le disent comme un événement mixte (`MixedEventAttendanceMode`) : un lieu virtuel (la page) et un lieu (la ville). On ne prétend pas organiser la manif dans la rue, et une manif passée n'est pas marquée comme à venir.
