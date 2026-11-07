-- Index de la tâche de publication (un passage toutes les 5 s, sous verrou exclusif).

-- Compteurs et effacement par manif, sans parcourir toute la table des avatars.
create index avatar_manif on avatar (manif_id);

-- Manifs dont des hachages de jetons de retrait restent à effacer (ADR 0001) :
-- index partiel, vide une fois les manifs terminées traitées.
create index avatar_hachage_retrait on avatar (manif_id) where hachage_retrait is not null;
