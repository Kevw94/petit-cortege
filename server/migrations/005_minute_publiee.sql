-- Marque haute de la tâche de publication : toute minute antérieure à
-- `avant` est publiée (immuable). Écrite par la publication sous verrou
-- exclusif, lue par chaque entrée sous verrou partagé : une entrée tombe
-- toujours dans une minute pas encore publiée, même si l'horloge du
-- processus qui la reçoit retarde sur celle du processus qui publie.
create table publication_etat (
  unique_ligne boolean primary key default true check (unique_ligne),
  avant        timestamptz not null
);
