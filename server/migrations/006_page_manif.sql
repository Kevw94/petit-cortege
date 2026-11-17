-- Page publique d'une manif (ADR 0010) : étapes annoncées, et date de
-- dernière modification pour le sitemap. Les manifs déjà en base n'ont pas
-- d'étapes (elles n'étaient pas stockées) ; `modifiee` part de maintenant.
alter table manif add column etapes jsonb not null default '[]';
alter table manif add column modifiee timestamptz not null default now();
