-- Vertrauensstufen, Herkunft der Daten, Braustätten-Typ, Unternehmen, Aliase, manuelle Korrekturen

-- ---------------------------------------------------------------- Brauereien
alter table public.breweries add column if not exists trust text not null default 'user';
alter table public.breweries add column if not exists sources jsonb not null default '{}'::jsonb;
alter table public.breweries add column if not exists brewery_type text;      -- brauerei | gasthausbrauerei | kommunbrauhaus | museumsbrauerei | marke
alter table public.breweries add column if not exists region text;            -- Regierungsbezirk
alter table public.breweries add column if not exists district text;          -- Landkreis / kreisfreie Stadt
alter table public.breweries add column if not exists founded text;
alter table public.breweries add column if not exists geo_precision text;     -- wikidata | adresse | ort | gemeinde
alter table public.breweries add column if not exists parent_id uuid references public.breweries (id) on delete set null;

do $$ begin
  alter table public.breweries add constraint breweries_trust_chk check (trust in ('verified', 'unverified', 'user'));
exception when duplicate_object then null; end $$;

create index if not exists breweries_parent_id_idx on public.breweries (parent_id);

-- Bisher importierte Einträge sind ungeprüft, eigene bleiben eigene
update public.breweries set trust = 'unverified' where source <> 'user' and trust = 'user';

-- ---------------------------------------------------------------- Biere
alter table public.beers add column if not exists trust text not null default 'user';
alter table public.beers add column if not exists sources jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.beers add constraint beers_trust_chk check (trust in ('verified', 'unverified', 'user'));
exception when duplicate_object then null; end $$;

update public.beers set trust = 'unverified' where source <> 'user' and trust = 'user';

-- ---------------------------------------------------------------- Aliase (Markennamen → Brauerei)
create table if not exists public.brewery_aliases (
  id          bigint generated always as identity primary key,
  brewery_id  uuid not null references public.breweries (id) on delete cascade,
  alias       text not null,
  alias_key   text not null,
  source      text not null default 'user',
  created_at  timestamptz not null default now(),
  unique (brewery_id, alias_key)
);
create index if not exists brewery_aliases_key_idx on public.brewery_aliases (alias_key);

alter table public.brewery_aliases enable row level security;
drop policy if exists brewery_aliases_select on public.brewery_aliases;
create policy brewery_aliases_select on public.brewery_aliases for select to authenticated using (true);
drop policy if exists brewery_aliases_insert on public.brewery_aliases;
create policy brewery_aliases_insert on public.brewery_aliases for insert to authenticated with check (true);
grant select, insert on public.brewery_aliases to authenticated;

-- ---------------------------------------------------------------- Manuelle Korrekturen (Prüfliste)
create table if not exists public.match_overrides (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('brand', 'beer', 'brewery')),
  source_key  text not null,                 -- z. B. normalisierter Markenname
  target_id   uuid,                          -- Brauerei bzw. Bier, dem es zugeordnet wird
  action      text not null check (action in ('match', 'reject')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, source_key)
);

alter table public.match_overrides enable row level security;
drop policy if exists match_overrides_all on public.match_overrides;
create policy match_overrides_all on public.match_overrides for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.match_overrides to authenticated;

-- ---------------------------------------------------------------- Caches für den Import (nicht über die API erreichbar)
create schema if not exists app_private;
create table if not exists app_private.geocode_cache (
  query       text primary key,
  lat         double precision,
  lng         double precision,
  state       text,
  precision   text,
  fetched_at  timestamptz not null default now()
);
create table if not exists app_private.web_cache (
  url         text primary key,
  logo_url    text,
  status      integer,
  fetched_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- Fortschritt pro Brauerei (mit Vertrauensstufe & Typ)
drop function if exists public.brewery_progress();

create function public.brewery_progress()
returns table (
  id uuid, name text, city text, state text, country text,
  lat double precision, lng double precision,
  logo_url text, image_url text,
  trust text, brewery_type text, parent_id uuid,
  total integer, drunk integer, wished integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select distinct beer_id from public.checkins where user_id = (select auth.uid())
  ), wish as (
    select beer_id from public.wishlist where user_id = (select auth.uid())
  )
  select b.id, b.name, b.city, b.state, b.country, b.lat, b.lng,
         b.logo_url,
         (array_agg(be.image_url order by (be.trust = 'verified') desc, be.name) filter (where be.image_url is not null))[1] as image_url,
         b.trust, b.brewery_type, b.parent_id,
         count(be.id)::integer as total,
         count(be.id) filter (where be.id in (select beer_id from mine))::integer as drunk,
         count(be.id) filter (where be.id in (select beer_id from wish))::integer as wished
  from public.breweries b
  left join public.beers be on be.brewery_id = b.id
  group by b.id
  order by b.name;
$$;

revoke execute on function public.brewery_progress() from public, anon;
grant execute on function public.brewery_progress() to authenticated;

-- Suche: geprüfte Biere zuerst
create or replace function public.search_beers(q text)
returns setof public.beers
language sql
stable
security invoker
set search_path = ''
as $$
  select be.*
  from public.beers be
  left join public.breweries br on br.id = be.brewery_id
  where not exists (
    select 1 from unnest(string_to_array(lower(btrim(q)), ' ')) w
    where w <> '' and position(w in lower(be.name || ' ' || coalesce(br.name, ''))) = 0
  )
  order by (lower(be.name) like lower(btrim(q)) || '%') desc, (be.trust = 'verified') desc, be.name
  limit 60;
$$;
