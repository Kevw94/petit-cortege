# Petit Cortège

Jeu web pour soutenir à distance une manif réelle : un cortège virtuel en pixel art suit le parcours et l'horaire annoncés. Vocabulaire : [`GLOSSARY.md`](GLOSSARY.md). Décisions : [`docs/adr/`](docs/adr/). Périmètre : [`docs/perimetre-v1.md`](docs/perimetre-v1.md).

## Structure

Un seul dépôt TypeScript, workspaces npm :

| Dossier   | Rôle |
|-----------|------|
| `shared/` | Format v1 des fichiers publiés, horaire (2 km/h, fin), géométrie du parcours. Importé par tous. |
| `server/` | Node + Hono + Postgres : tâche de publication (liste des manifs, entrées par minute), horloge injectable. |
| `client/` | Phaser + Vite. Page publique `/manif/<id>` (ADR 0010) ; les anciens liens `#/manif/<id>` marchent encore. Le **Cortège** (`client/src/cortege/`) est une fonction pure. |
| `scripts/`| Outils de dev et de production (seed, lancement local ; plus tard OSM, palettes). |
| `fixtures/publication/` | Fichiers publiés par les tests du serveur, relus par les tests du Cortège. Versionnés. |

## Prérequis

- Node ≥ 22.12
- Postgres 16 accessible sur `postgres://postgres:postgres@localhost:5432` (dev et tests). Le plus simple, avec Docker :

  ```sh
  npm run db:start   # docker compose : Postgres 16, utilisateur et mot de passe « postgres »
  npm run db:stop
  ```

  Sans Docker (ex. Homebrew sur macOS) : `brew install postgresql@16 && brew services start postgresql@16`, puis créer le rôle attendu : `createuser -s postgres` et `psql -d postgres -c "alter role postgres password 'postgres'"`. Ou pointer vers un Postgres existant avec `DATABASE_URL` (dev) et `DATABASE_ADMIN_URL` (tests).

## Commandes

```sh
npm install
npm run db:start   # si Postgres n'est pas déjà lancé
npm run dev        # base de dev + manif pré-remplie + serveur (8787) + client Vite (5173)
npm run seed       # resème seulement la manif de démo
npm test           # Vitest : serveur (vrai Postgres) + Cortège
npm run typecheck  # tsc strict dans chaque workspace
npm run lint       # Biome : lint et vérification du formatage (biome.json)
npm run format     # Biome : formate le code
npm run build      # build du client
```

Puis ouvrir http://localhost:5173/manif/demo-republique-nation (départ 2 min après le lancement).

Variables utiles : `DATABASE_URL` (base de dev), `DATABASE_ADMIN_URL` (tests : une base jetable par fichier de test y est créée), `PORT_SERVEUR`, `PORT_CLIENT`, `DOSSIER_PUBLICATION`. `VITE_UMAMI_WEBSITE_ID` (UUID Umami, lu au build du client seulement) active la mesure d'audience ; absente, aucun script n'est chargé. Voir `client/.env.example`.

## Mise en ligne

Le site en production, https://petit-cortege.fr, est un VPS OVH à Strasbourg (Ubuntu 24.04) : Postgres, serveur Node et Nginx. Les fichiers statiques et publiés partent de ce serveur, sans CDN (ADR 0005). La mesure d'audience est Umami, sur le même serveur (`stats.petit-cortege.fr`) : elle se branche au build via `VITE_UMAMI_WEBSITE_ID`.

Les scripts de [`deploiement/`](deploiement/) décrivent une autre installation, avec Caddy. Guide : [`docs/deploiement.md`](docs/deploiement.md). La configuration Nginx en production, dont l'en-tête Content-Security-Policy et le relais de `/manif/` et `/sitemap.xml` vers Node, n'est pas dans ce dépôt : elle se recopie à la main sur le VPS. Le `Caddyfile` du dépôt, lui, est installé par les scripts.

## Tests

Deux seams seulement (voir la spec) :

1. **Le serveur**, par HTTP contre un vrai Postgres, avec une horloge contrôlée (`server/test/`). Les fichiers publiés sont enregistrés dans `fixtures/publication/<scénario>/`.
2. **Le Cortège**, fonction pure sans Phaser ni réseau (`client/src/cortege/`), qui lit ces fixtures.

Si un test serveur change le format publié, les fixtures changent aussi : les committer avec.
