-- Brauereien ausblenden (Getränkehändler, Gaststätten ohne eigenes Bier, Dubletten, geschlossene Betriebe).
-- Wie bei Bieren: gilt für die eigene Runde (circle_overrides) und wird als Vorschlag erfasst; ein Admin
-- übernimmt es in den Katalog. Ausgeblendete Brauereien bleiben als „Grabstein“ stehen, der Import legt sie nicht neu an.

alter table public.breweries add column if not exists hidden_at timestamptz;
alter table public.breweries add column if not exists hidden_by uuid references auth.users (id) on delete set null;
alter table public.breweries add column if not exists hidden_reason text;   -- keine_brauerei | doppelt | geschlossen

-- neue Vorschlagsarten
alter table public.catalog_suggestions drop constraint if exists catalog_suggestions_kind_check;
alter table public.catalog_suggestions add constraint catalog_suggestions_kind_check
  check (kind in ('beer_edit', 'brewery_edit', 'beer_hide', 'beer_unhide', 'beer_new', 'brewery_new', 'barcode',
                  'brewery_hide', 'brewery_unhide'));

-- ---------------------------------------------------------------- Ausblenden / Einblenden
create or replace function public.hide_breweries(p_ids uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.breweries;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  if p_reason not in ('keine_brauerei', 'doppelt', 'geschlossen') then
    raise exception 'Unbekannter Grund' using errcode = '22023';
  end if;
  for b in select * from public.breweries where id = any(p_ids) and (circle_id is null or circle_id = cid) loop
    if b.circle_id = cid then
      update public.breweries set hidden_at = now(), hidden_reason = p_reason, hidden_by = (select auth.uid()) where id = b.id;
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where target_id = b.id and kind = 'brewery_new' and status = 'offen';
    else
      insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
      values (cid, 'brewery', b.id, jsonb_build_object('hidden_at', now(), 'hidden_reason', p_reason), (select auth.uid()))
      on conflict (circle_id, kind, target_id) do update
        set data = public.circle_overrides.data || excluded.data, updated_by = excluded.updated_by, updated_at = now();
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where circle_id = cid and target_id = b.id and kind = 'brewery_unhide' and status = 'offen';
      if b.hidden_at is null then
        perform app_private.suggest('brewery_hide', b.id, b.name, jsonb_build_object('reason', p_reason), '{}'::jsonb);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.unhide_breweries(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.breweries;
  had_open boolean;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  for b in select * from public.breweries where id = any(p_ids) and (circle_id is null or circle_id = cid) loop
    if b.circle_id = cid then
      update public.breweries set hidden_at = null, hidden_reason = null, hidden_by = null where id = b.id;
      update public.catalog_suggestions set status = 'offen', updated_at = now()
       where target_id = b.id and kind = 'brewery_new' and status = 'zurückgezogen';
    else
      update public.circle_overrides
         set data = (data - 'hidden_at' - 'hidden_reason') || case when b.hidden_at is not null
                    then jsonb_build_object('hidden_at', null) else '{}'::jsonb end,
             updated_at = now()
       where circle_id = cid and kind = 'brewery' and target_id = b.id;
      if not found and b.hidden_at is not null then
        insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
        values (cid, 'brewery', b.id, jsonb_build_object('hidden_at', null), (select auth.uid()));
      end if;
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where circle_id = cid and target_id = b.id and kind = 'brewery_hide' and status = 'offen';
      had_open := found;
      if not had_open and b.hidden_at is not null then
        perform app_private.suggest('brewery_unhide', b.id, b.name, '{}'::jsonb, jsonb_build_object('hidden_reason', b.hidden_reason));
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.hide_breweries(uuid[], text), public.unhide_breweries(uuid[]) from public, anon;
grant execute on function public.hide_breweries(uuid[], text), public.unhide_breweries(uuid[]) to authenticated;

-- Für die Liste „Ausgeblendet“: alle für die eigene Runde ausgeblendeten Brauereien (mit Runden-Namen)
create or replace function public.hidden_breweries()
returns table (id uuid, name text, city text, state text, hidden_reason text, in_catalog boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id)
  select b.id,
         coalesce(o.data ->> 'name', b.name),
         case when o.data ? 'city' then o.data ->> 'city' else b.city end,
         case when o.data ? 'state' then o.data ->> 'state' else b.state end,
         case when o.data ? 'hidden_at' then o.data ->> 'hidden_reason' else b.hidden_reason end,
         not (o.data ? 'hidden_at')
  from public.breweries b
  left join public.circle_overrides o on o.kind = 'brewery' and o.target_id = b.id and o.circle_id = (select id from c)
  where (b.circle_id is null or b.circle_id = (select id from c))
    and (case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is not null else b.hidden_at is not null end)
  order by 2;
$$;

-- ---------------------------------------------------------------- Admin: übernehmen (um Brauerei-Ausblenden erweitert)
create or replace function public.apply_suggestion(p_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.catalog_suggestions;
  keys text[];
  br uuid;
begin
  if not (select public.is_admin()) then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  select * into s from public.catalog_suggestions where id = p_id for update;
  if s.id is null then raise exception 'Vorschlag nicht gefunden' using errcode = 'P0002'; end if;
  if s.status <> 'offen' then return s.status; end if;

  if s.kind = 'beer_edit' then
    select array_agg(k) into keys from jsonb_object_keys(s.payload) k;
    update public.beers set
      name = coalesce(s.payload ->> 'name', name),
      style = case when s.payload ? 'style' then nullif(s.payload ->> 'style', '') else style end,
      abv = case when s.payload ? 'abv' then (s.payload ->> 'abv')::numeric else abv end,
      locked = (select array_agg(distinct x) from unnest(locked || coalesce(keys, '{}')) x)
    where id = s.target_id;
  elsif s.kind = 'brewery_edit' then
    select array_agg(k) into keys from jsonb_object_keys(s.payload) k;
    update public.breweries set
      name = coalesce(s.payload ->> 'name', name),
      city = case when s.payload ? 'city' then nullif(s.payload ->> 'city', '') else city end,
      state = case when s.payload ? 'state' then nullif(s.payload ->> 'state', '') else state end,
      country = case when s.payload ? 'country' then coalesce(nullif(s.payload ->> 'country', ''), country) else country end,
      website = case when s.payload ? 'website' then nullif(s.payload ->> 'website', '') else website end,
      lat = case when s.payload ? 'lat' then (s.payload ->> 'lat')::double precision else lat end,
      lng = case when s.payload ? 'lng' then (s.payload ->> 'lng')::double precision else lng end,
      geo_precision = case when s.payload ? 'lat' then 'nutzer' else geo_precision end,
      locked = (select array_agg(distinct x) from unnest(locked || coalesce(keys, '{}')) x)
    where id = s.target_id;
  elsif s.kind = 'beer_hide' then
    update public.beers set hidden_at = now(), hidden_reason = s.payload ->> 'reason', hidden_by = s.created_by
     where id = s.target_id;
  elsif s.kind = 'beer_unhide' then
    update public.beers set hidden_at = null, hidden_reason = null, hidden_by = null where id = s.target_id;
  elsif s.kind = 'brewery_hide' then
    update public.breweries set hidden_at = now(), hidden_reason = s.payload ->> 'reason', hidden_by = s.created_by
     where id = s.target_id;
  elsif s.kind = 'brewery_unhide' then
    update public.breweries set hidden_at = null, hidden_reason = null, hidden_by = null where id = s.target_id;
  elsif s.kind = 'brewery_new' then
    update public.breweries set circle_id = null where id = s.target_id;
  elsif s.kind = 'beer_new' then
    -- Brauerei der Runde gleich mit übernehmen
    select brewery_id into br from public.beers where id = s.target_id;
    update public.breweries set circle_id = null where id = br and circle_id is not null;
    update public.catalog_suggestions set status = 'übernommen', decided_by = (select auth.uid()), decided_at = now()
     where target_id = br and kind = 'brewery_new' and status = 'offen';
    update public.beers set circle_id = null where id = s.target_id;
  elsif s.kind = 'barcode' then
    if exists (select 1 from public.beer_barcodes where ean = s.payload ->> 'ean' and circle_id is null) then
      update public.catalog_suggestions set status = 'abgelehnt', decided_by = (select auth.uid()), decided_at = now(),
             note = 'Barcode gehört im Katalog schon zu einem anderen Bier' where id = s.id;
      return 'abgelehnt';
    end if;
    update public.beer_barcodes set circle_id = null
     where ean = s.payload ->> 'ean' and circle_id = s.circle_id;
  end if;

  update public.catalog_suggestions set status = 'übernommen', decided_by = (select auth.uid()), decided_at = now()
   where id = s.id;
  return 'übernommen';
end;
$$;

-- ---------------------------------------------------------------- Lesen: ausgeblendete Brauereien weglassen
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

create or replace function public.search_beers(q text)
returns setof public.beers
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id)
  select be.*
  from public.beers be
  left join public.breweries br on br.id = be.brewery_id
  left join public.circle_overrides o on o.kind = 'beer' and o.target_id = be.id and o.circle_id = (select id from c)
  left join public.circle_overrides bo on bo.kind = 'brewery' and bo.target_id = br.id and bo.circle_id = (select id from c)
  where (be.circle_id is null or be.circle_id = (select id from c))
    and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else be.hidden_at is null end
    and (br.id is null or not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else br.hidden_at is not null end))
    and not exists (
      select 1 from unnest(string_to_array(lower(btrim(q)), ' ')) w
      where w <> '' and position(w in lower(coalesce(o.data ->> 'name', be.name) || ' '
                                             || coalesce(bo.data ->> 'name', br.name, ''))) = 0
    )
  order by (lower(coalesce(o.data ->> 'name', be.name)) like lower(btrim(q)) || '%') desc,
           (be.circle_id is not null) desc, (be.trust = 'verified') desc, be.name
  limit 60;
$$;
