# Petit Cortège

Jeu web pour soutenir à distance une manif réelle : un cortège virtuel en pixel art suit le parcours et l'horaire annoncés. Vocabulaire : [`GLOSSARY.md`](GLOSSARY.md). Décisions : [`docs/adr/`](docs/adr/). Périmètre : [`docs/perimetre-v1.md`](docs/perimetre-v1.md).

## Structure

Un seul dépôt TypeScript, workspaces npm :

| Dossier   | Rôle |
|-----------|------|
| `shared/` | Format v1 des fichiers publiés, horaire (2 km/h, fin), géométrie du parcours. Importé par tous. |
| `server/` | Node + Hono + Postgres : tâche de publication (liste des manifs, entrées par minute), horloge injectable. |
| `client/` | Phaser + Vite. Routage par fragment `#/manif/<id>` (ADR 0002). Le **Cortège** (`client/src/cortege/`) est une fonction pure. |
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
npm run build      # build du client
```

Puis ouvrir http://localhost:5173/#/manif/demo-republique-nation (départ 2 min après le lancement).

Variables utiles : `DATABASE_URL` (base de dev), `DATABASE_ADMIN_URL` (tests : une base jetable par fichier de test y est créée), `PORT_SERVEUR`, `PORT_CLIENT`, `DOSSIER_PUBLICATION`.

## Mise en ligne

Déploiement sur un VPS (Postgres + serveur Node + Caddy, sans Supabase : ADR 0005) : guide pas à pas dans [`docs/deploiement.md`](docs/deploiement.md), scripts et configuration dans [`deploiement/`](deploiement/).

## Tests

Deux seams seulement (voir la spec) :

1. **Le serveur**, par HTTP contre un vrai Postgres, avec une horloge contrôlée (`server/test/`). Les fichiers publiés sont enregistrés dans `fixtures/publication/<scénario>/`.
2. **Le Cortège**, fonction pure sans Phaser ni réseau (`client/src/cortege/`), qui lit ces fixtures.

Si un test serveur change le format publié, les fixtures changent aussi : les committer avec.
