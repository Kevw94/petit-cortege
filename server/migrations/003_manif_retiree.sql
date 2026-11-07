-- Manif retirée par la modération (ex. arrêté d'interdiction, ADR 0003) :
-- elle n'est plus publiée dans la liste et les entrées sont refusées.
-- La ligne est gardée (ses avatars et les fichiers d'entrées déjà publiés y renvoient).
alter table manif add column retiree timestamptz;
alter table manif add column motif_retrait text;
