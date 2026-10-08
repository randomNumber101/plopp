-- Bier-App: Grundschema
-- Idempotent: kann mehrfach ausgeführt werden.

-- ---------------------------------------------------------------------------
-- Hilfsfunktion: updated_at pflegen
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Katalog: Brauereien
-- ---------------------------------------------------------------------------
create table if not exists public.breweries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  city        text,
  state       text,                                   -- Bundesland
  country     text not null default 'Deutschland',
  lat         double precision,
  lng         double precision,
  website     text,
  source      text not null default 'user',           -- user | off | scraper:<name>
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists breweries_name_city_uq
  on public.breweries (lower(name), lower(coalesce(city, '')));
create index if not exists breweries_created_by_idx on public.breweries (created_by);

drop trigger if exists breweries_updated_at on public.breweries;
create trigger breweries_updated_at before update on public.breweries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Katalog: Biere
-- ---------------------------------------------------------------------------
create table if not exists public.beers (
  id          uuid primary key default gen_random_uuid(),
  brewery_id  uuid references public.breweries (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  style       text,                                   -- Pils, Helles, Weizen, IPA ...
  abv         numeric(4, 1) check (abv >= 0 and abv <= 70),
  image_url   text,
  source      text not null default 'user',
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists beers_brewery_id_idx on public.beers (brewery_id);
create index if not exists beers_created_by_idx on public.beers (created_by);
create unique index if not exists beers_brewery_name_uq
  on public.beers (brewery_id, lower(name));

drop trigger if exists beers_updated_at on public.beers;
create trigger beers_updated_at before update on public.beers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Katalog: Barcodes (ein Bier kann mehrere EANs haben)
-- ---------------------------------------------------------------------------
create table if not exists public.beer_barcodes (
  ean         text primary key check (ean ~ '^[0-9]{8,14}$'),
  beer_id     uuid not null references public.beers (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists beer_barcodes_beer_id_idx on public.beer_barcodes (beer_id);

-- ---------------------------------------------------------------------------
-- Persönlich: Check-ins (getrunken)
-- ---------------------------------------------------------------------------
create table if not exists public.checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  beer_id     uuid not null references public.beers (id) on delete cascade,
  drunk_at    timestamptz not null default now(),
  rating      smallint check (rating between 1 and 5),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists checkins_user_drunk_idx on public.checkins (user_id, drunk_at desc);
create index if not exists checkins_beer_id_idx on public.checkins (beer_id);

-- ---------------------------------------------------------------------------
-- Persönlich: Merkliste
-- ---------------------------------------------------------------------------
create table if not exists public.wishlist (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  beer_id     uuid not null references public.beers (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, beer_id)
);

create index if not exists wishlist_beer_id_idx on public.wishlist (beer_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.breweries     enable row level security;
alter table public.beers         enable row level security;
alter table public.beer_barcodes enable row level security;
alter table public.checkins      enable row level security;
alter table public.wishlist      enable row level security;

-- Katalog: angemeldete Nutzer lesen/ergänzen/korrigieren; löschen nur eigene Einträge.
-- (Registrierung wird nach dem Anlegen des eigenen Kontos deaktiviert.)
drop policy if exists breweries_select on public.breweries;
create policy breweries_select on public.breweries for select to authenticated using (true);
drop policy if exists breweries_insert on public.breweries;
create policy breweries_insert on public.breweries for insert to authenticated
  with check ((select auth.uid()) = created_by);
drop policy if exists breweries_update on public.breweries;
create policy breweries_update on public.breweries for update to authenticated
  using (true) with check (true);
drop policy if exists breweries_delete on public.breweries;
create policy breweries_delete on public.breweries for delete to authenticated
  using ((select auth.uid()) = created_by);

drop policy if exists beers_select on public.beers;
create policy beers_select on public.beers for select to authenticated using (true);
drop policy if exists beers_insert on public.beers;
create policy beers_insert on public.beers for insert to authenticated
  with check ((select auth.uid()) = created_by);
drop policy if exists beers_update on public.beers;
create policy beers_update on public.beers for update to authenticated
  using (true) with check (true);
drop policy if exists beers_delete on public.beers;
create policy beers_delete on public.beers for delete to authenticated
  using ((select auth.uid()) = created_by);

drop policy if exists beer_barcodes_select on public.beer_barcodes;
create policy beer_barcodes_select on public.beer_barcodes for select to authenticated using (true);
drop policy if exists beer_barcodes_insert on public.beer_barcodes;
create policy beer_barcodes_insert on public.beer_barcodes for insert to authenticated with check (true);

-- Persönliche Daten: nur eigene Zeilen
drop policy if exists checkins_own on public.checkins;
create policy checkins_own on public.checkins for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists wishlist_own on public.wishlist;
create policy wishlist_own on public.wishlist for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Rechte für die Data API (explizit, falls Tabellen nicht automatisch freigegeben werden)
-- ---------------------------------------------------------------------------
revoke all on public.breweries, public.beers, public.beer_barcodes,
              public.checkins, public.wishlist from anon;

grant select, insert, update, delete on public.breweries     to authenticated;
grant select, insert, update, delete on public.beers         to authenticated;
grant select, insert                 on public.beer_barcodes to authenticated;
grant select, insert, update, delete on public.checkins      to authenticated;
grant select, insert, delete         on public.wishlist      to authenticated;

-- ---------------------------------------------------------------------------
-- Funktionen
-- ---------------------------------------------------------------------------

-- Für den wöchentlichen Keep-alive-Ping (öffentlich, verrät nichts)
create or replace function public.ping()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$ select 1 $$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- Fortschritt pro Brauerei für den angemeldeten Nutzer (für Karte & Brauerei-Liste)
create or replace function public.brewery_progress()
returns table (
  id uuid, name text, city text, state text, country text,
  lat double precision, lng double precision,
  total integer, drunk integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.name, b.city, b.state, b.country, b.lat, b.lng,
         count(be.id)::integer as total,
         count(be.id) filter (
           where exists (
             select 1 from public.checkins c
             where c.beer_id = be.id and c.user_id = (select auth.uid())
           )
         )::integer as drunk
  from public.breweries b
  left join public.beers be on be.brewery_id = b.id
  group by b.id
  order by b.name;
$$;

revoke execute on function public.brewery_progress() from public, anon;
grant execute on function public.brewery_progress() to authenticated;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
