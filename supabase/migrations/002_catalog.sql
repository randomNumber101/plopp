-- Katalog: externe IDs für den automatischen Import (Wikidata, Open Food Facts)
alter table public.breweries add column if not exists ext_id text;
alter table public.beers     add column if not exists ext_id text;

create unique index if not exists breweries_ext_id_uq on public.breweries (ext_id);
create unique index if not exists beers_ext_id_uq     on public.beers (ext_id);

-- Bei Marken aus Open Food Facts ist das Herkunftsland oft unbekannt
alter table public.breweries alter column country drop not null;

