-- Runden & Änderungsvorschläge
--
-- Eine „Runde“ ist eine Person plus alle, die über ihre Einladungslinks dazugekommen sind (und deren Eingeladene).
-- Was jemand am Katalog ändert (Namen, Sorte, Brauerei-Angaben, ausblenden, neue Biere/Brauereien/Barcodes),
-- gilt sofort nur für die eigene Runde. Jede Änderung landet zusätzlich als Vorschlag in public.catalog_suggestions.
-- Admins entscheiden dort, was in den echten Katalog übernommen wird (apply_suggestion / reject_suggestion).
-- Übernommene Felder werden gesperrt (locked), damit der Katalog-Import sie nicht wieder überschreibt.

-- ---------------------------------------------------------------- Runden
create table if not exists public.circles (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.circle_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  circle_id   uuid not null references public.circles (id) on delete cascade,
  joined_at   timestamptz not null default now()
);
create index if not exists circle_members_circle_idx on public.circle_members (circle_id);

-- Admins (dürfen Vorschläge übernehmen)
create table if not exists app_private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.my_circle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select circle_id from public.circle_members where user_id = (select auth.uid())
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app_private.admins where user_id = (select auth.uid()))
$$;

/** Für Konten ohne Runde (z. B. das Gründerkonto): eigene Runde anlegen */
create or replace function public.ensure_circle()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid uuid;
begin
  if uid is null then
    return null;
  end if;
  select circle_id into cid from public.circle_members where user_id = uid;
  if cid is null then
    insert into public.circles default values returning id into cid;
    insert into public.circle_members (user_id, circle_id) values (uid, cid) on conflict (user_id) do nothing;
    select circle_id into cid from public.circle_members where user_id = uid;
  end if;
  return cid;
end;
$$;

revoke execute on function public.my_circle(), public.is_admin(), public.ensure_circle() from public, anon;
grant execute on function public.my_circle(), public.is_admin(), public.ensure_circle() to authenticated;

-- Bestehende Konten einsortieren: Gründer (ohne Einladung) bekommen eine Runde und werden Admin,
-- Eingeladene kommen in die Runde der einladenden Person (auch über mehrere Stufen).
do $$
declare
  r record;
  cid uuid;
  changed boolean := true;
begin
  for r in select u.id from auth.users u
           where not exists (select 1 from public.invites i where i.used_by = u.id)
             and not exists (select 1 from public.circle_members m where m.user_id = u.id)
  loop
    insert into public.circles default values returning id into cid;
    insert into public.circle_members (user_id, circle_id) values (r.id, cid);
    insert into app_private.admins (user_id) values (r.id) on conflict do nothing;
  end loop;
  while changed loop
    insert into public.circle_members (user_id, circle_id)
    select i.used_by, m.circle_id
      from public.invites i join public.circle_members m on m.user_id = i.created_by
     where i.used_by is not null
       and not exists (select 1 from public.circle_members x where x.user_id = i.used_by)
    on conflict (user_id) do nothing;
    changed := found;
  end loop;
end $$;

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
drop policy if exists circles_select on public.circles;
create policy circles_select on public.circles for select to authenticated using (id = (select public.my_circle()));
drop policy if exists circle_members_select on public.circle_members;
create policy circle_members_select on public.circle_members for select to authenticated
  using (circle_id = (select public.my_circle()));
revoke all on public.circles, public.circle_members from anon, authenticated;
grant select on public.circles, public.circle_members to authenticated;

-- Neue Konten: in die Runde der einladenden Person
create or replace function public.redeem_invite_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_code text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'invite', '')));
  inviter uuid;
  cid uuid;
begin
  update public.invites
     set used_by = new.id, used_email = new.email, used_at = now()
   where code = invite_code
     and used_at is null
     and expires_at > now()
  returning created_by into inviter;

  if inviter is null then
    raise exception 'Registrierung nur mit gültigem Einladungslink möglich'
      using errcode = '42501';
  end if;

  select circle_id into cid from public.circle_members where user_id = inviter;
  if cid is null then
    insert into public.circles default values returning id into cid;
    insert into public.circle_members (user_id, circle_id) values (inviter, cid) on conflict (user_id) do nothing;
  end if;
  insert into public.circle_members (user_id, circle_id) values (new.id, cid) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.redeem_invite_on_signup() from public, anon, authenticated;

-- ---------------------------------------------------------------- Katalog: Einträge einer Runde
alter table public.breweries add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.beers add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.beer_barcodes add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.breweries alter column circle_id set default public.my_circle();
alter table public.beers alter column circle_id set default public.my_circle();
alter table public.beer_barcodes alter column circle_id set default public.my_circle();

-- Vom Admin übernommene Felder (der Import überschreibt sie nicht mehr)
alter table public.breweries add column if not exists locked text[] not null default '{}';
alter table public.beers add column if not exists locked text[] not null default '{}';

create index if not exists breweries_circle_idx on public.breweries (circle_id) where circle_id is not null;
create index if not exists beers_circle_idx on public.beers (circle_id) where circle_id is not null;

-- Eindeutigkeit getrennt nach Katalog und Runden
drop index if exists public.breweries_name_city_uq;
create unique index if not exists breweries_name_city_uq
  on public.breweries (coalesce(circle_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name), lower(coalesce(city, '')));
drop index if exists public.beers_brewery_name_uq;
create unique index if not exists beers_brewery_name_uq
  on public.beers (brewery_id, coalesce(circle_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

alter table public.beer_barcodes drop constraint if exists beer_barcodes_pkey;
create unique index if not exists beer_barcodes_catalog_uq on public.beer_barcodes (ean) where circle_id is null;
create unique index if not exists beer_barcodes_circle_uq on public.beer_barcodes (ean, circle_id) where circle_id is not null;
create index if not exists beer_barcodes_ean_idx on public.beer_barcodes (ean);

-- Bisher von Nutzern angelegte Einträge (nicht mit dem Katalog verknüpft) gehören jetzt zur Runde des Erstellers
update public.breweries b set circle_id = m.circle_id
  from public.circle_members m
 where b.source = 'user' and b.ext_id is null and b.circle_id is null and m.user_id = b.created_by;
update public.beers b set circle_id = m.circle_id
  from public.circle_members m
 where b.source = 'user' and b.ext_id is null and b.circle_id is null and m.user_id = b.created_by;

-- Sichtbarkeit: Katalog für alle, Runden-Einträge nur für die Runde
drop policy if exists breweries_select on public.breweries;
create policy breweries_select on public.breweries for select to authenticated
  using (circle_id is null or circle_id = (select public.my_circle()));
drop policy if exists breweries_insert on public.breweries;
create policy breweries_insert on public.breweries for insert to authenticated
  with check ((select auth.uid()) = created_by and circle_id = (select public.my_circle()));
drop policy if exists breweries_update on public.breweries;
create policy breweries_update on public.breweries for update to authenticated
  using (circle_id = (select public.my_circle())) with check (circle_id = (select public.my_circle()));
drop policy if exists breweries_delete on public.breweries;
create policy breweries_delete on public.breweries for delete to authenticated
  using ((select auth.uid()) = created_by and circle_id = (select public.my_circle()));

drop policy if exists beers_select on public.beers;
create policy beers_select on public.beers for select to authenticated
  using (circle_id is null or circle_id = (select public.my_circle()));
drop policy if exists beers_insert on public.beers;
create policy beers_insert on public.beers for insert to authenticated
  with check ((select auth.uid()) = created_by and circle_id = (select public.my_circle()));
drop policy if exists beers_update on public.beers;
create policy beers_update on public.beers for update to authenticated
  using (circle_id = (select public.my_circle())) with check (circle_id = (select public.my_circle()));
drop policy if exists beers_delete on public.beers;
create policy beers_delete on public.beers for delete to authenticated
  using ((select auth.uid()) = created_by and circle_id = (select public.my_circle()));

drop policy if exists beer_barcodes_select on public.beer_barcodes;
create policy beer_barcodes_select on public.beer_barcodes for select to authenticated
  using (circle_id is null or circle_id = (select public.my_circle()));
drop policy if exists beer_barcodes_insert on public.beer_barcodes;
create policy beer_barcodes_insert on public.beer_barcodes for insert to authenticated
  with check (circle_id = (select public.my_circle()));

-- Import-Hilfstabellen: nur noch für Admins schreibbar
drop policy if exists brewery_aliases_insert on public.brewery_aliases;
create policy brewery_aliases_insert on public.brewery_aliases for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists match_overrides_all on public.match_overrides;
drop policy if exists match_overrides_select on public.match_overrides;
create policy match_overrides_select on public.match_overrides for select to authenticated using (true);
drop policy if exists match_overrides_admin on public.match_overrides;
create policy match_overrides_admin on public.match_overrides for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- Änderungen einer Runde an Katalog-Einträgen
create table if not exists public.circle_overrides (
  circle_id   uuid not null references public.circles (id) on delete cascade,
  kind        text not null check (kind in ('beer', 'brewery')),
  target_id   uuid not null,
  data        jsonb not null default '{}'::jsonb,   -- z. B. {"name": "...", "hidden_at": "...", "hidden_reason": "kein_bier"}
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (circle_id, kind, target_id)
);

alter table public.circle_overrides enable row level security;
drop policy if exists circle_overrides_select on public.circle_overrides;
create policy circle_overrides_select on public.circle_overrides for select to authenticated
  using (circle_id = (select public.my_circle()));
revoke all on public.circle_overrides from anon, authenticated;
grant select on public.circle_overrides to authenticated;

-- ---------------------------------------------------------------- Vorschläge
create table if not exists public.catalog_suggestions (
  id               bigint generated always as identity primary key,
  circle_id        uuid references public.circles (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  kind             text not null check (kind in ('beer_edit', 'brewery_edit', 'beer_hide', 'beer_unhide',
                                                 'beer_new', 'brewery_new', 'barcode')),
  target_id        uuid,               -- Bier bzw. Brauerei
  target_name      text,               -- zur Anzeige
  payload          jsonb not null default '{}'::jsonb,   -- neue Werte
  previous         jsonb not null default '{}'::jsonb,   -- Werte im Katalog zum Zeitpunkt des Vorschlags
  status           text not null default 'offen' check (status in ('offen', 'übernommen', 'abgelehnt', 'zurückgezogen')),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  note             text
);
create index if not exists catalog_suggestions_open_idx on public.catalog_suggestions (status, created_at desc);
create index if not exists catalog_suggestions_target_idx on public.catalog_suggestions (target_id);

alter table public.catalog_suggestions enable row level security;
drop policy if exists catalog_suggestions_select on public.catalog_suggestions;
create policy catalog_suggestions_select on public.catalog_suggestions for select to authenticated
  using (circle_id = (select public.my_circle()) or (select public.is_admin()));
revoke all on public.catalog_suggestions from anon, authenticated;
grant select on public.catalog_suggestions to authenticated;

/** Vorschlag anlegen bzw. einen offenen Vorschlag derselben Runde zum selben Ziel ergänzen */
create or replace function app_private.suggest(p_kind text, p_target uuid, p_name text, p_payload jsonb, p_previous jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid uuid := (select public.my_circle());
  sid bigint;
begin
  select id into sid from public.catalog_suggestions
   where circle_id is not distinct from cid and kind = p_kind and target_id is not distinct from p_target
     and status = 'offen'
   order by id desc limit 1;
  if sid is not null then
    update public.catalog_suggestions
       set payload = payload || p_payload, target_name = coalesce(p_name, target_name), updated_at = now()
     where id = sid;
  else
    insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload, previous)
    values (cid, uid, (select email from auth.users where id = uid), p_kind, p_target, p_name, p_payload, coalesce(p_previous, '{}'::jsonb));
  end if;
end;
$$;

-- Neue Einträge einer Runde automatisch als Vorschlag erfassen
create or replace function app_private.suggest_new_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.circle_id is null then
    return new;
  end if;
  if tg_table_name = 'beers' then
    insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload)
    values (new.circle_id, new.created_by, (select email from auth.users where id = new.created_by), 'beer_new', new.id,
            new.name, jsonb_build_object('name', new.name, 'style', new.style, 'abv', new.abv, 'brewery_id', new.brewery_id));
  elsif tg_table_name = 'breweries' then
    insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload)
    values (new.circle_id, new.created_by, (select email from auth.users where id = new.created_by), 'brewery_new', new.id,
            new.name, jsonb_build_object('name', new.name, 'city', new.city, 'state', new.state, 'country', new.country));
  elsif tg_table_name = 'beer_barcodes' then
    insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload)
    values (new.circle_id, (select auth.uid()), (select email from auth.users where id = (select auth.uid())), 'barcode',
            new.beer_id, (select name from public.beers where id = new.beer_id), jsonb_build_object('ean', new.ean));
  end if;
  return new;
end;
$$;

drop trigger if exists beers_suggest_new on public.beers;
create trigger beers_suggest_new after insert on public.beers
  for each row when (new.circle_id is not null) execute function app_private.suggest_new_row();
drop trigger if exists breweries_suggest_new on public.breweries;
create trigger breweries_suggest_new after insert on public.breweries
  for each row when (new.circle_id is not null) execute function app_private.suggest_new_row();
drop trigger if exists barcodes_suggest_new on public.beer_barcodes;
create trigger barcodes_suggest_new after insert on public.beer_barcodes
  for each row when (new.circle_id is not null) execute function app_private.suggest_new_row();

-- Bisherige Nutzer-Einträge als offene Vorschläge nachtragen
insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload)
select b.circle_id, b.created_by, u.email, 'brewery_new', b.id, b.name,
       jsonb_build_object('name', b.name, 'city', b.city, 'state', b.state, 'country', b.country)
  from public.breweries b left join auth.users u on u.id = b.created_by
 where b.circle_id is not null
   and not exists (select 1 from public.catalog_suggestions s where s.target_id = b.id and s.kind = 'brewery_new');
insert into public.catalog_suggestions (circle_id, created_by, created_by_email, kind, target_id, target_name, payload)
select b.circle_id, b.created_by, u.email, 'beer_new', b.id, b.name,
       jsonb_build_object('name', b.name, 'style', b.style, 'abv', b.abv, 'brewery_id', b.brewery_id)
  from public.beers b left join auth.users u on u.id = b.created_by
 where b.circle_id is not null
   and not exists (select 1 from public.catalog_suggestions s where s.target_id = b.id and s.kind = 'beer_new');

-- ---------------------------------------------------------------- Ändern (App ruft nur diese Funktionen auf)
create or replace function public.edit_beer(p_beer uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.beers;
  ch jsonb;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  select * into b from public.beers where id = p_beer and (circle_id is null or circle_id = cid);
  if b.id is null then raise exception 'Bier nicht gefunden' using errcode = 'P0002'; end if;
  -- nur erlaubte Felder
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into ch
    from jsonb_each(p_changes) where key in ('name', 'style', 'abv');
  if ch ? 'name' and length(btrim(coalesce(ch ->> 'name', ''))) = 0 then
    raise exception 'Name darf nicht leer sein' using errcode = '22023';
  end if;

  if b.circle_id = cid then
    -- eigener Eintrag der Runde: direkt ändern (wird als Ganzes vorgeschlagen)
    update public.beers set
      name = coalesce(ch ->> 'name', name),
      style = case when ch ? 'style' then nullif(ch ->> 'style', '') else style end,
      abv = case when ch ? 'abv' then (ch ->> 'abv')::numeric else abv end
    where id = b.id;
    update public.catalog_suggestions set payload = payload || ch, target_name = coalesce(ch ->> 'name', target_name), updated_at = now()
     where target_id = b.id and kind = 'beer_new' and status = 'offen';
  else
    insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
    values (cid, 'beer', b.id, ch, (select auth.uid()))
    on conflict (circle_id, kind, target_id) do update
      set data = public.circle_overrides.data || excluded.data, updated_by = excluded.updated_by, updated_at = now();
    perform app_private.suggest('beer_edit', b.id, coalesce(ch ->> 'name', b.name), ch,
                                jsonb_build_object('name', b.name, 'style', b.style, 'abv', b.abv));
  end if;
end;
$$;

create or replace function public.edit_brewery(p_brewery uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.breweries;
  ch jsonb;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  select * into b from public.breweries where id = p_brewery and (circle_id is null or circle_id = cid);
  if b.id is null then raise exception 'Brauerei nicht gefunden' using errcode = 'P0002'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into ch
    from jsonb_each(p_changes) where key in ('name', 'city', 'state', 'country', 'website', 'lat', 'lng');
  if ch ? 'name' and length(btrim(coalesce(ch ->> 'name', ''))) = 0 then
    raise exception 'Name darf nicht leer sein' using errcode = '22023';
  end if;

  if b.circle_id = cid then
    update public.breweries set
      name = coalesce(ch ->> 'name', name),
      city = case when ch ? 'city' then nullif(ch ->> 'city', '') else city end,
      state = case when ch ? 'state' then nullif(ch ->> 'state', '') else state end,
      country = case when ch ? 'country' then coalesce(nullif(ch ->> 'country', ''), country) else country end,
      website = case when ch ? 'website' then nullif(ch ->> 'website', '') else website end,
      lat = case when ch ? 'lat' then (ch ->> 'lat')::double precision else lat end,
      lng = case when ch ? 'lng' then (ch ->> 'lng')::double precision else lng end
    where id = b.id;
    update public.catalog_suggestions set payload = payload || ch, target_name = coalesce(ch ->> 'name', target_name), updated_at = now()
     where target_id = b.id and kind = 'brewery_new' and status = 'offen';
  else
    insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
    values (cid, 'brewery', b.id, ch, (select auth.uid()))
    on conflict (circle_id, kind, target_id) do update
      set data = public.circle_overrides.data || excluded.data, updated_by = excluded.updated_by, updated_at = now();
    perform app_private.suggest('brewery_edit', b.id, coalesce(ch ->> 'name', b.name), ch,
                                jsonb_build_object('name', b.name, 'city', b.city, 'state', b.state, 'country', b.country,
                                                   'website', b.website, 'lat', b.lat, 'lng', b.lng));
  end if;
end;
$$;

create or replace function public.hide_beers(p_ids uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.beers;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  if p_reason not in ('kein_bier', 'doppelt', 'falsch') then raise exception 'Unbekannter Grund' using errcode = '22023'; end if;
  for b in select * from public.beers where id = any(p_ids) and (circle_id is null or circle_id = cid) loop
    if b.circle_id = cid then
      update public.beers set hidden_at = now(), hidden_reason = p_reason, hidden_by = (select auth.uid()) where id = b.id;
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where target_id = b.id and kind = 'beer_new' and status = 'offen';
    else
      insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
      values (cid, 'beer', b.id, jsonb_build_object('hidden_at', now(), 'hidden_reason', p_reason), (select auth.uid()))
      on conflict (circle_id, kind, target_id) do update
        set data = public.circle_overrides.data || excluded.data, updated_by = excluded.updated_by, updated_at = now();
      -- ein offener „wieder einblenden“-Vorschlag erledigt sich damit
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where circle_id = cid and target_id = b.id and kind = 'beer_unhide' and status = 'offen';
      perform app_private.suggest('beer_hide', b.id, b.name, jsonb_build_object('reason', p_reason), '{}'::jsonb);
    end if;
  end loop;
end;
$$;

create or replace function public.unhide_beers(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := (select public.my_circle());
  b public.beers;
  had_open boolean;
begin
  if cid is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  for b in select * from public.beers where id = any(p_ids) and (circle_id is null or circle_id = cid) loop
    if b.circle_id = cid then
      update public.beers set hidden_at = null, hidden_reason = null, hidden_by = null where id = b.id;
      update public.catalog_suggestions set status = 'offen', updated_at = now()
       where target_id = b.id and kind = 'beer_new' and status = 'zurückgezogen';
    else
      update public.circle_overrides
         set data = data - 'hidden_at' - 'hidden_reason' || case when b.hidden_at is not null
                    then jsonb_build_object('hidden_at', null) else '{}'::jsonb end,
             updated_at = now()
       where circle_id = cid and kind = 'beer' and target_id = b.id;
      if not found and b.hidden_at is not null then
        insert into public.circle_overrides (circle_id, kind, target_id, data, updated_by)
        values (cid, 'beer', b.id, jsonb_build_object('hidden_at', null), (select auth.uid()));
      end if;
      update public.catalog_suggestions set status = 'zurückgezogen', updated_at = now()
       where circle_id = cid and target_id = b.id and kind = 'beer_hide' and status = 'offen';
      had_open := found;
      -- Nur wenn der Eintrag im Katalog ausgeblendet ist, braucht es einen Vorschlag zum Einblenden
      if not had_open and b.hidden_at is not null then
        perform app_private.suggest('beer_unhide', b.id, b.name, '{}'::jsonb, jsonb_build_object('hidden_reason', b.hidden_reason));
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.edit_beer(uuid, jsonb), public.edit_brewery(uuid, jsonb),
  public.hide_beers(uuid[], text), public.unhide_beers(uuid[]) from public, anon;
grant execute on function public.edit_beer(uuid, jsonb), public.edit_brewery(uuid, jsonb),
  public.hide_beers(uuid[], text), public.unhide_beers(uuid[]) to authenticated;
revoke execute on function app_private.suggest(text, uuid, text, jsonb, jsonb), app_private.suggest_new_row() from public;

-- ---------------------------------------------------------------- Admin: übernehmen / ablehnen
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

create or replace function public.reject_suggestion(p_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  update public.catalog_suggestions
     set status = 'abgelehnt', decided_by = (select auth.uid()), decided_at = now(), note = p_note
   where id = p_id and status = 'offen';
end;
$$;

revoke execute on function public.apply_suggestion(bigint), public.reject_suggestion(bigint, text) from public, anon;
grant execute on function public.apply_suggestion(bigint), public.reject_suggestion(bigint, text) to authenticated;

-- ---------------------------------------------------------------- Lesen mit Runden-Änderungen
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
  where b.circle_id is null or b.circle_id = (select id from c)
  group by b.id, bo.data
  order by b.name, b.id;
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
  where (be.circle_id is null or be.circle_id = (select id from c))
    and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else be.hidden_at is null end
    and not exists (
      select 1 from unnest(string_to_array(lower(btrim(q)), ' ')) w
      where w <> '' and position(w in lower(coalesce(o.data ->> 'name', be.name) || ' ' || coalesce(br.name, ''))) = 0
    )
  order by (lower(coalesce(o.data ->> 'name', be.name)) like lower(btrim(q)) || '%') desc,
           (be.circle_id is not null) desc, (be.trust = 'verified') desc, be.name
  limit 60;
$$;
