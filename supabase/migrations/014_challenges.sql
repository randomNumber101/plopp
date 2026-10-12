-- Abend-Challenges: Jeder Abend läuft von 16 Uhr bis 4 Uhr. Man wählt eine von drei zufälligen Challenges,
-- erfüllt sie (automatisch erkannt oder selbst bestätigt) und darf danach die nächste wählen.
-- Die Liste der Challenges steht in der App (src/challenges.ts); hier wird nur gespeichert, was man gemacht hat.

create table if not exists public.challenges (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  night        date not null,                 -- Abend (Datum des Starts um 16 Uhr)
  challenge    text not null,                 -- ID aus der App
  started_at   timestamptz not null default now(),
  ends_at      timestamptz not null,          -- 4 Uhr am nächsten Morgen
  completed_at timestamptz,
  status       text not null default 'aktiv' check (status in ('aktiv', 'geschafft', 'abgebrochen', 'verpasst')),
  confirmed    boolean not null default false, -- selbst bestätigt (statt automatisch erkannt)
  data         jsonb not null default '{}'::jsonb  -- Momentaufnahme beim Start (z. B. Merkliste)
);

create index if not exists challenges_user_night_idx on public.challenges (user_id, night desc);
-- höchstens eine laufende Challenge pro Person
create unique index if not exists challenges_one_active_uq on public.challenges (user_id) where status = 'aktiv';

alter table public.challenges enable row level security;
drop policy if exists challenges_own on public.challenges;
create policy challenges_own on public.challenges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.challenges to authenticated;
