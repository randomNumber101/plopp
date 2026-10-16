-- Hausfarbe der Brauerei für den Kronkorken im Kasten-Design (#rrggbb).
-- Gepflegt im Admin-Programm (vorbelegt aus dem Logo); ohne Farbe leitet die App eine stabile Farbe aus dem Namen ab.
-- Der Katalog-Lauf (scraper/load.py) fasst die Spalte nicht an; Admin-Änderungen daran überstehen jeden Lauf.

alter table public.breweries add column if not exists cap_color text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'breweries_cap_color_hex') then
    alter table public.breweries add constraint breweries_cap_color_hex check (cap_color is null or cap_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- Fortschritt je Brauerei liefert jetzt auch die Hausfarbe (Rückgabetyp ändert sich → neu anlegen)
drop function if exists public.brewery_progress();
create or replace function public.brewery_progress()
returns table (
  id uuid, name text, city text, state text, country text,
  lat double precision, lng double precision,
  logo_url text, cap_color text, image_url text,
  trust text, brewery_type text, parent_id uuid,
  total integer, drunk integer, wished integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id),
  mine as (
    select distinct beer_id from public.checkins where user_id = (select auth.uid())
  ), wish as (
    select beer_id from public.wishlist where user_id = (select auth.uid())
  ), bo as (
    select o.target_id, o.data from public.circle_overrides o, c where o.circle_id = c.id and o.kind = 'brewery'
  ), be as (
    select x.* from public.beers x
    left join public.circle_overrides o on o.kind = 'beer' and o.target_id = x.id and o.circle_id = (select id from c)
    where (x.circle_id is null or x.circle_id = (select id from c))
      and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else x.hidden_at is null end
  )
  select b.id,
         coalesce(bo.data ->> 'name', b.name),
         case when bo.data ? 'city' then bo.data ->> 'city' else b.city end,
         case when bo.data ? 'state' then bo.data ->> 'state' else b.state end,
         coalesce(bo.data ->> 'country', b.country),
         coalesce((bo.data ->> 'lat')::double precision, b.lat),
         coalesce((bo.data ->> 'lng')::double precision, b.lng),
         b.logo_url,
         b.cap_color,
         (array_agg(be.image_url order by (be.trust = 'verified') desc, be.name) filter (where be.image_url is not null))[1],
         b.trust, b.brewery_type, b.parent_id,
         count(be.id)::integer,
         count(be.id) filter (where be.id in (select beer_id from mine))::integer,
         count(be.id) filter (where be.id in (select beer_id from wish))::integer
  from public.breweries b
  left join bo on bo.target_id = b.id
  left join be on be.brewery_id = b.id
  where (b.circle_id is null or b.circle_id = (select id from c))
    and not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else b.hidden_at is not null end)
  group by b.id, bo.data
  order by 2, b.id;
$$;

revoke execute on function public.brewery_progress() from public, anon;
grant execute on function public.brewery_progress() to authenticated;

-- Suchindex: Hausfarbe als 7. Feld der Brauerei
create or replace function public.search_index()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id),
  bo as (
    select o.target_id, o.data from public.circle_overrides o where o.circle_id = (select id from c) and o.kind = 'brewery'
  ),
  br as (
    select b.id,
           coalesce(bo.data ->> 'name', b.name) as name,
           case when bo.data ? 'city' then bo.data ->> 'city' else b.city end as city,
           b.logo_url, b.trust, b.brewery_type, b.cap_color
    from public.breweries b
    left join bo on bo.target_id = b.id
    where (b.circle_id is null or b.circle_id = (select id from c))
      and not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else b.hidden_at is not null end)
  ),
  be as (
    select x.id,
           coalesce(o.data ->> 'name', x.name) as name,
           case when o.data ? 'style' then o.data ->> 'style' else x.style end as style,
           case when o.data ? 'abv' then (o.data ->> 'abv')::numeric else x.abv end as abv,
           x.brewery_id, x.image_url, x.trust
    from public.beers x
    left join public.circle_overrides o on o.kind = 'beer' and o.target_id = x.id and o.circle_id = (select id from c)
    where (x.circle_id is null or x.circle_id = (select id from c))
      and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else x.hidden_at is null end
      and (x.brewery_id is null or x.brewery_id in (select id from br))
  )
  select jsonb_build_object(
    'v', 1,
    'breweries', coalesce((select jsonb_agg(jsonb_build_array(id, name, city, logo_url, left(trust, 1), brewery_type, cap_color)) from br), '[]'::jsonb),
    'beers', coalesce((select jsonb_agg(jsonb_build_array(id, name, style, abv, brewery_id, image_url, left(trust, 1))) from be), '[]'::jsonb)
  );
$$;

revoke execute on function public.search_index() from public, anon;
grant execute on function public.search_index() to authenticated;

-- Admin-Änderungen dürfen die Hausfarbe setzen
create or replace function app_private.apply_admin_edit(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.admin_edits;
  tid uuid;
  v jsonb;
  b public.beers;
begin
  select * into e from public.admin_edits where id = p_id;
  if e.id is null or not e.active or e.kind = 'brand' then return false; end if;
  v := e.new_value;
  if v = 'null'::jsonb then v := null; end if;

  if e.kind = 'brewery' then
    select id into tid from public.breweries where id = e.target_id;
    if tid is null and e.target_ext is not null then
      select id into tid from public.breweries where ext_id = e.target_ext;
    end if;
  else
    select id into tid from public.beers where id = e.target_id;
    if tid is null and e.target_ext is not null then
      select id into tid from public.beers where ext_id = e.target_ext;
    end if;
  end if;
  if tid is null then return false; end if;
  if tid is distinct from e.target_id then
    update public.admin_edits set target_id = tid where id = e.id;
  end if;

  if e.field = 'hidden' then
    if e.kind = 'brewery' then
      update public.breweries set hidden_at = case when v is null then null else coalesce(hidden_at, now()) end,
                                  hidden_reason = v ->> 0, locked = (select array_agg(distinct x) from unnest(locked || array['hidden']) x) where id = tid;
    else
      update public.beers set hidden_at = case when v is null then null else coalesce(hidden_at, now()) end,
                              hidden_reason = v ->> 0, locked = (select array_agg(distinct x) from unnest(locked || array['hidden']) x) where id = tid;
    end if;
    return true;
  end if;

  if e.kind = 'brewery' and e.field = 'merged_into' then
    if v is null or (v ->> 0)::uuid = tid then return false; end if;
    for b in select * from public.beers where brewery_id = tid and circle_id is null loop
      perform app_private.move_beer(b.id, (v ->> 0)::uuid);
    end loop;
    insert into public.brewery_aliases (brewery_id, alias, alias_key, source)
      select (v ->> 0)::uuid, a.alias, a.alias_key, 'zusammengelegt' from public.brewery_aliases a where a.brewery_id = tid
      on conflict do nothing;
    update public.breweries set hidden_at = coalesce(hidden_at, now()), hidden_reason = 'doppelt', locked = (select array_agg(distinct x) from unnest(locked || array['hidden']) x) where id = tid;
    return true;
  end if;

  if e.kind = 'beer' and e.field = 'brewery_id' then
    if v is null then return false; end if;
    perform app_private.move_beer(tid, (v ->> 0)::uuid);
    return true;
  end if;

  -- gewöhnliche Spalten: Typumwandlung über jsonb_populate_record
  if e.kind = 'brewery' then
    if e.field not in ('name', 'city', 'state', 'country', 'lat', 'lng', 'website', 'logo_url', 'brewery_type',
                       'street', 'postcode', 'trust', 'parent_id', 'region', 'district', 'founded', 'cap_color') then
      return false;
    end if;
    execute format(
      'update public.breweries t set %1$I = (jsonb_populate_record(null::public.breweries, jsonb_build_object(%2$L, $1))).%1$I,
              locked = (select array_agg(distinct x) from unnest(t.locked || $2) x)
        where t.id = $3', e.field, e.field)
      using v, case when e.field in ('lat', 'lng') then array['lat', 'lng'] else array[e.field] end, tid;
    if e.field in ('lat', 'lng') then
      update public.breweries set geo_precision = 'nutzer' where id = tid;
    end if;
  else
    if e.field not in ('name', 'style', 'abv', 'image_url', 'trust') then return false; end if;
    execute format(
      'update public.beers t set %1$I = (jsonb_populate_record(null::public.beers, jsonb_build_object(%2$L, $1))).%1$I,
              locked = (select array_agg(distinct x) from unnest(t.locked || $2) x)
        where t.id = $3', e.field, e.field)
      using v, array[e.field], tid;
  end if;
  return true;
end;
$$;
