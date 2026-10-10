-- Katalog-Aufbau sichtbar machen und Marken ohne Brauerei zuordnen.
-- 1. catalog_runs: Fortschritt jedes Laufs (Schritt, Prozent, Stand) – die App zeigt ihn live an.
-- 2. app_private.source_cache: letzter guter Stand je Quelle (Rückfall, wenn z. B. OpenStreetMap ausfällt).
-- 3. unassigned_brands() / assign_brand(): Admin ordnet Open-Food-Facts-Marken einer Brauerei zu – sofort in der
--    Datenbank und dauerhaft für alle künftigen Katalog-Läufe (match_overrides).

create table if not exists public.catalog_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'läuft' check (status in ('läuft', 'fertig', 'fehler', 'abgebrochen')),
  step        integer not null default 0,
  steps       integer not null default 0,
  phase       text,
  done        integer,
  total       integer,
  detail      text,
  stats       jsonb,
  run_url     text
);
create index if not exists catalog_runs_started_idx on public.catalog_runs (started_at desc);
alter table public.catalog_runs enable row level security;
drop policy if exists catalog_runs_select on public.catalog_runs;
create policy catalog_runs_select on public.catalog_runs for select to authenticated using (true);
grant select on public.catalog_runs to authenticated;

create table if not exists app_private.source_cache (
  name       text primary key,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Marken ohne Brauerei
-- Markenschlüssel wie im Katalog-Import (ext_id „off-brand:<schlüssel-mit-bindestrichen>“)
create or replace function public.brand_key(p_ext text, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_ext like 'off-brand:%' then replace(substr(p_ext, 11), '-', ' ')
              else lower(regexp_replace(p_name, '[^[:alnum:]]+', ' ', 'g')) end;
$$;

create or replace function public.unassigned_brands()
returns table (id uuid, name text, beers integer, examples text[], eans text[])
language sql
stable
security definer
set search_path = ''
as $$
  select br.id, br.name,
         count(be.id)::integer,
         (array_agg(be.name order by be.name))[1:4],
         (array_agg(bc.ean order by bc.ean) filter (where bc.ean is not null))[1:3]
  from public.breweries br
  left join public.beers be on be.brewery_id = br.id and be.hidden_at is null
  left join lateral (select ean from public.beer_barcodes x where x.beer_id = be.id and x.circle_id is null limit 1) bc on true
  where br.brewery_type = 'marke' and br.circle_id is null and br.hidden_at is null
    and (select public.is_admin())
    -- als „keine Brauerei / Handelsmarke“ bestätigt → nicht mehr fragen
    and not exists (select 1 from public.match_overrides o where o.kind = 'brand' and o.action = 'reject'
                    and o.source_key = public.brand_key(br.ext_id, br.name))
  group by br.id, br.name
  order by count(be.id) desc, br.name
$$;
revoke execute on function public.unassigned_brands() from public, anon;
grant execute on function public.unassigned_brands() to authenticated;

-- Marke einer Brauerei zuordnen (p_target) bzw. als „keine Brauerei / Handelsmarke“ markieren (p_target null).
-- Biere wandern sofort zur Brauerei; gleichnamige werden zusammengelegt (Check-ins, Merkliste, Barcodes mit).
create or replace function public.assign_brand(p_brand uuid, p_target uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.breweries;
  t public.breweries;
  k text;
  be public.beers;
  twin uuid;
  moved integer := 0;
begin
  if not (select public.is_admin()) then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  select * into b from public.breweries where id = p_brand and brewery_type = 'marke';
  if b.id is null then raise exception 'Marke nicht gefunden' using errcode = 'P0002'; end if;
  -- Schlüssel wie im Katalog-Import: ext_id „off-brand:<schlüssel-mit-bindestrichen>“
  k := public.brand_key(b.ext_id, b.name);

  if p_target is null then
    insert into public.match_overrides (kind, source_key, target_id, action)
    values ('brand', k, null, 'reject')
    on conflict (kind, source_key) do update set target_id = null, action = 'reject', created_at = now();
    return 0;
  end if;

  select * into t from public.breweries where id = p_target and circle_id is null;
  if t.id is null or t.id = b.id then raise exception 'Brauerei nicht gefunden' using errcode = 'P0002'; end if;

  insert into public.match_overrides (kind, source_key, target_id, action)
  values ('brand', k, t.id, 'match')
  on conflict (kind, source_key) do update set target_id = excluded.target_id, action = 'match', created_at = now();

  insert into public.brewery_aliases (brewery_id, alias, alias_key, source)
  values (t.id, b.name, k, 'zuordnung')
  on conflict do nothing;

  for be in select * from public.beers where brewery_id = b.id and circle_id is null loop
    select id into twin from public.beers
     where brewery_id = t.id and circle_id is null and lower(name) = lower(be.name) limit 1;
    if twin is null then
      -- ext_id leeren: der nächste Katalog-Lauf verknüpft das Bier über Brauerei + Name neu
      update public.beers set brewery_id = t.id, ext_id = null where id = be.id;
    else
      update public.beer_barcodes set beer_id = twin where beer_id = be.id;
      update public.checkins set beer_id = twin where beer_id = be.id;
      insert into public.wishlist (user_id, beer_id, created_at)
        select user_id, twin, created_at from public.wishlist where beer_id = be.id
        on conflict do nothing;
      delete from public.wishlist where beer_id = be.id;
      delete from public.beers where id = be.id;
    end if;
    moved := moved + 1;
  end loop;
  -- leere Marke entfernen, wenn nichts mehr daran hängt
  delete from public.breweries x where x.id = b.id
    and not exists (select 1 from public.beers y where y.brewery_id = x.id);
  return moved;
end;
$$;
revoke execute on function public.assign_brand(uuid, uuid) from public, anon;
grant execute on function public.assign_brand(uuid, uuid) to authenticated;
