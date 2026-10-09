-- Registrierung nur mit Einladungslink
-- Jede Person mit Konto kann Einladungslinks erzeugen. Ein Link gilt für genau ein neues Konto
-- und läuft nach 14 Tagen ab. Ohne gültigen Link schlägt die Registrierung in der Datenbank fehl –
-- auch wenn jemand die Auth-API direkt aufruft.

create table if not exists public.invites (
  code        text primary key default replace(gen_random_uuid()::text, '-', ''),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_by     uuid references auth.users (id) on delete set null,
  used_email  text,
  used_at     timestamptz
);

create index if not exists invites_created_by_idx on public.invites (created_by, created_at desc);
create index if not exists invites_used_by_idx on public.invites (used_by);

alter table public.invites enable row level security;

-- Eigene Einladungen sehen und (unbenutzte) zurückziehen; erzeugt wird über create_invite()
drop policy if exists invites_select_own on public.invites;
create policy invites_select_own on public.invites for select to authenticated
  using ((select auth.uid()) = created_by);
drop policy if exists invites_delete_own on public.invites;
create policy invites_delete_own on public.invites for delete to authenticated
  using ((select auth.uid()) = created_by and used_at is null);

revoke all on public.invites from anon, authenticated;
grant select, delete on public.invites to authenticated;

-- ---------------------------------------------------------------- Einladung erzeugen
create or replace function public.create_invite()
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  open_count integer;
  inv public.invites;
begin
  if uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  select count(*) into open_count from public.invites
   where created_by = uid and used_at is null and expires_at > now();
  if open_count >= 20 then
    raise exception 'Du hast schon 20 offene Einladungen. Zieh erst welche zurück.' using errcode = 'P0001';
  end if;
  insert into public.invites (created_by) values (uid) returning * into inv;
  return inv;
end;
$$;

revoke execute on function public.create_invite() from public, anon;
grant execute on function public.create_invite() to authenticated;

-- ---------------------------------------------------------------- Einladung prüfen (vor der Registrierung)
create or replace function public.invite_status(invite_code text)
returns text   -- 'ok' | 'used' | 'expired' | 'unknown'
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when i.used_at is not null then 'used'
              when i.expires_at <= now() then 'expired'
              else 'ok'
            end
       from public.invites i
      where i.code = lower(btrim(invite_code))),
    'unknown');
$$;

revoke execute on function public.invite_status(text) from public;
grant execute on function public.invite_status(text) to anon, authenticated;

-- ---------------------------------------------------------------- Einladung beim Anlegen des Kontos einlösen
create or replace function public.redeem_invite_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_code text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'invite', '')));
  redeemed text;
begin
  update public.invites
     set used_by = new.id, used_email = new.email, used_at = now()
   where code = invite_code
     and used_at is null
     and expires_at > now()
  returning code into redeemed;

  if redeemed is null then
    raise exception 'Registrierung nur mit gültigem Einladungslink möglich'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.redeem_invite_on_signup() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_redeem_invite on auth.users;
create trigger on_auth_user_created_redeem_invite
  after insert on auth.users
  for each row execute function public.redeem_invite_on_signup();
