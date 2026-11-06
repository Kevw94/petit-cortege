-- Aucune IP ni aucun identifiant de personne n'est stocké (ADR 0001).

create table manif (
  id          text primary key,
  intitule    text not null,
  ville       text not null,
  ouverture   timestamptz not null,
  depart      timestamptz not null,
  parcours    jsonb not null,
  sources     jsonb not null default '[]'
);

-- Avatar : enregistrement anonyme (manif, heure d'entrée, indices d'apparence et de pancarte).
create table avatar (
  id          text primary key,
  manif_id    text not null references manif (id),
  entree      timestamptz not null,
  apparence   integer not null,
  pancarte    integer not null
);

create index avatar_entree on avatar (entree);
