-- Biere ausblenden (Merch, Dubletten, falsche Einträge) – für alle Nutzer, rückgängig machbar.
-- Ausgeblendete Einträge bleiben als „Grabstein“ in der Tabelle, damit der Katalog-Import sie nicht neu anlegt.

alter table public.beers add column if not exists hidden_at timestamptz;
alter table public.beers add column if not exists hidden_by uuid references auth.users (id) on delete set null;
alter table public.beers add column if not exists hidden_reason text;   -- kein_bier | doppelt | falsch

create index if not exists beers_visible_brewery_idx on public.beers (brewery_id) where hidden_at is null;

-- Fortschritt je Brauerei: ausgeblendete Biere zählen nicht mit
create or replace function public.brewery_progress()
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
  left join public.beers be on be.brewery_id = b.id and be.hidden_at is null
  group by b.id
  order by b.name, b.id;
$$;

-- Suche: ausgeblendete Biere nicht anzeigen
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
  where be.hidden_at is null
    and not exists (
      select 1 from unnest(string_to_array(lower(btrim(q)), ' ')) w
      where w <> '' and position(w in lower(be.name || ' ' || coalesce(br.name, ''))) = 0
    )
  order by (lower(be.name) like lower(btrim(q)) || '%') desc, (be.trust = 'verified') desc, be.name
  limit 60;
$$;
