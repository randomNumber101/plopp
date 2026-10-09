-- Stabile Sortierung, damit seitenweises Laden (je 1000 Zeilen) keine Einträge überspringt
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
  left join public.beers be on be.brewery_id = b.id
  group by b.id
  order by b.name, b.id;
$$;
