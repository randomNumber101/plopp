-- Manuelle Änderungen aus dem Admin-Programm (Plopp/admin)
--
-- Jede Änderung ist eine Zeile: Eintrag, Feld, alter und neuer Wert. Sie wird sofort angewendet und das Feld
-- gesperrt (locked). Nach jedem Katalog-Lauf wendet public.apply_admin_edits() alle aktiven Änderungen erneut an –
-- auch wenn der Eintrag inzwischen neu angelegt wurde (Wiedererkennung über die ext_id).
--
-- Besondere Felder:
--   hidden       neuer Wert = Grund (z. B. "keine_brauerei") oder null = einblenden
--   merged_into  (Brauerei) Biere wandern zur Ziel-Brauerei, gleichnamige werden zusammengelegt, Quelle wird ausgeblendet
--   assign       (Marke) nur Protokoll – die Zuordnung selbst steckt in match_overrides

create table if not exists public.admin_edits (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('beer', 'brewery', 'brand')),
  target_id   uuid,
  target_ext  text,
  target_name text,
  field       text not null,
  old_value   jsonb,
  new_value   jsonb,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists admin_edits_target_idx on public.admin_edits (kind, target_id, field) where active;
create index if not exists admin_edits_ext_idx on public.admin_edits (target_ext) where active;

alter table public.admin_edits enable row level security;
revoke all on public.admin_edits from anon, authenticated;

-- Logos aus dem Admin-Programm
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------- Bier zu einer anderen Brauerei verschieben
-- Liegt dort schon ein gleichnamiges Bier, wird zusammengelegt (Barcodes, Check-ins, Merkliste). → Ziel-Bier
create or replace function app_private.move_beer(p_beer uuid, p_brewery uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  be public.beers;
  twin uuid;
begin
  select * into be from public.beers where id = p_beer;
  if be.id is null or be.brewery_id = p_brewery then return be.id; end if;
  select id into twin from public.beers
   where brewery_id = p_brewery and circle_id is null and id <> be.id and lower(name) = lower(be.name)
   order by (trust = 'verified') desc, created_at limit 1;
  if twin is null then
    update public.beers
       set brewery_id = p_brewery,
           locked = (select array_agg(distinct x) from unnest(locked || array['brewery_id']) x)
     where id = be.id;
    return be.id;
  end if;
  update public.beer_barcodes set beer_id = twin where beer_id = be.id;
  update public.checkins set beer_id = twin where beer_id = be.id;
  insert into public.wishlist (user_id, beer_id, created_at)
    select user_id, twin, created_at from public.wishlist where beer_id = be.id
    on conflict do nothing;
  delete from public.wishlist where beer_id = be.id;
  update public.beers t set
    style = coalesce(t.style, be.style), abv = coalesce(t.abv, be.abv), image_url = coalesce(t.image_url, be.image_url)
   where t.id = twin;
  update public.admin_edits set target_id = twin where kind = 'beer' and target_id = be.id;
  delete from public.beers where id = be.id;
  return twin;
end;
$$;

-- ---------------------------------------------------------------- Eine Änderung anwenden
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
                       'street', 'postcode', 'trust', 'parent_id', 'region', 'district', 'founded') then
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

-- ---------------------------------------------------------------- Alle aktiven Änderungen (z. B. nach einem Katalog-Lauf)
create or replace function public.apply_admin_edits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  -- je Eintrag und Feld zählt die neueste Änderung; Zusammenlegungen zuletzt
  for r in
    select id from (
      select distinct on (kind, coalesce(target_id::text, target_ext), field) id, field
        from public.admin_edits
       where active and kind <> 'brand'
       order by kind, coalesce(target_id::text, target_ext), field, id desc
    ) x order by (field = 'merged_into'), id
  loop
    if app_private.apply_admin_edit(r.id) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.apply_admin_edits(), app_private.apply_admin_edit(bigint),
  app_private.move_beer(uuid, uuid) from public, anon, authenticated;
