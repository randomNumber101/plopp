-- Bierquiz: beantwortete Fragen (der Fragen-Katalog steht in der App, src/quiz.ts)
create table if not exists public.quiz_answers (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question    text not null,
  correct     boolean not null,
  exact       boolean not null default false,   -- Schätzfrage genau getroffen
  answered_at timestamptz not null default now()
);
create index if not exists quiz_answers_user_idx on public.quiz_answers (user_id, answered_at);

alter table public.quiz_answers enable row level security;
drop policy if exists quiz_answers_own on public.quiz_answers;
create policy quiz_answers_own on public.quiz_answers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.quiz_answers to authenticated;
