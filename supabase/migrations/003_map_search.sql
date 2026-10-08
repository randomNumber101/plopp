-- Logos für die Karte + Suche über Bier- und Brauereinamen

alter table public.breweries add column if not exists logo_url text;

-- Rückgabetyp ändert sich → Funktion neu anlegen
drop function if exists public.brewery_progress();

create function public.brewery_progress()
returns table (
  id uuid, name text, city text, state text, country text,
  lat double precision, lng double precision,
  logo_url text, image_url text,
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
         (array_agg(be.image_url order by be.name) filter (where be.image_url is not null))[1] as image_url,
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

-- Suche: alle Wörter müssen im Bier- oder Brauereinamen vorkommen ("krombacher weizen")
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
  order by (lower(be.name) like lower(btrim(q)) || '%') desc, be.name
  limit 60;
$$;

revoke execute on function public.search_beers(text) from public, anon;
grant execute on function public.search_beers(text) to authenticated;
