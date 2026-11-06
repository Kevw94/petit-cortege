-- Retrait d'un avatar (ADR 0001).

-- SHA-256 du jeton de retrait du soutien (jamais le jeton). Nul : pas de jeton
-- fourni, ou hachage effacé dans l'heure qui suit la fin de la manif (#15).
alter table avatar add column hachage_retrait bytea;

-- Avatars retirés, par le soutien ou par modération. L'avatar anonyme est
-- conservé pour que son identifiant reste publié dans le fichier des retraits.
create table retrait (
  avatar_id   text primary key references avatar (id),
  motif       text not null check (motif in ('soutien', 'moderation'))
);
